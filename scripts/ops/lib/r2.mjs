import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import {
  S3Client, ListObjectsV2Command, DeleteObjectCommand, CopyObjectCommand, HeadObjectCommand, GetObjectCommand,
} from '@aws-sdk/client-s3';
import { requireEnv } from './env.mjs';

export function r2Client() {
  requireEnv('R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY');
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

export function backupsBucket() {
  return process.env.R2_BUCKET_BACKUPS || 'greenthumb-backups';
}

/** @returns {Promise<Array<{key: string, size: number, lastModified: Date}>>} */
export async function listObjects(client, bucket, prefix = '') {
  const out = [];
  let token;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: prefix || undefined, MaxKeys: 1000, ContinuationToken: token,
    }));
    for (const o of page.Contents ?? []) out.push({ key: o.Key, size: o.Size ?? 0, lastModified: o.LastModified });
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (page.IsTruncated && !token) throw new Error('R2 list: missing continuation token');
  } while (token);
  return out;
}

export async function objectExists(client, bucket, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

export async function copyObject(client, bucket, fromKey, toKey) {
  await client.send(new CopyObjectCommand({
    Bucket: bucket, Key: toKey, CopySource: `${bucket}/${encodeURIComponent(fromKey).replace(/%2F/g, '/')}`,
  }));
}

/** One request per key: DeleteObjects needs a checksum that R2 + SDK 3.1156 may reject. */
export async function deleteKeys(client, bucket, keys) {
  for (const key of keys) await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function downloadObject(client, bucket, key, file) {
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  await pipeline(res.Body, createWriteStream(file, { mode: 0o600 }));
}
