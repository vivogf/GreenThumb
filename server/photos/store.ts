import type { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { PhotoObjectStore } from "./photoChange";

export const PHOTO_CACHE_CONTROL = "public, max-age=31536000, immutable";

export interface PhotoObject {
  body: Readable;
  contentLength?: number;
  etag?: string;
}

export interface PhotoStore extends PhotoObjectStore {
  /** null when the object does not exist. */
  getStream(key: string): Promise<PhotoObject | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<Array<{ key: string; size: number; lastModified?: Date }>>;
}

export interface PhotoConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
}

export function photoConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PhotoConfig | null {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET_PHOTOS;
  const publicBaseUrl = env.PHOTO_PUBLIC_BASE_URL?.replace(/\/+$/, "");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

function isNotFound(err: any): boolean {
  return err?.name === "NoSuchKey" || err?.name === "NotFound" || err?.$metadata?.httpStatusCode === 404;
}

export class R2PhotoStore implements PhotoStore {
  private readonly client: S3Client;

  constructor(private readonly config: PhotoConfig) {
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.eu.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async put(key: string, bytes: Buffer, mime: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: bytes,
      ContentType: mime,
      CacheControl: PHOTO_CACHE_CONTROL,
    }));
  }

  async getStream(key: string): Promise<PhotoObject | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      if (!res.Body) return null;
      return { body: res.Body as Readable, contentLength: res.ContentLength, etag: res.ETag };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  async deleteMany(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      let failed: string[];
      try {
        const res = await this.client.send(new DeleteObjectsCommand({
          Bucket: this.config.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }));
        failed = (res.Errors ?? []).map((e) => e.Key).filter((k): k is string => !!k);
      } catch {
        // DeleteObjects needs a request checksum that R2 + this SDK may reject; single deletes always work.
        failed = batch;
      }
      for (const key of failed) await this.delete(key);
    }
  }

  async list(prefix: string): Promise<Array<{ key: string; size: number; lastModified?: Date }>> {
    const out: Array<{ key: string; size: number; lastModified?: Date }> = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({
        Bucket: this.config.bucket, Prefix: prefix, MaxKeys: 1000, ContinuationToken: token,
      }));
      for (const o of page.Contents ?? []) {
        if (o.Key) out.push({ key: o.Key, size: o.Size ?? 0, lastModified: o.LastModified });
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
      if (page.IsTruncated && !token) throw new Error("R2 list: missing continuation token");
    } while (token);
    return out;
  }
}

export interface PhotoRuntime {
  store: PhotoStore;
  publicBaseUrl: string;
}

let runtime: PhotoRuntime | null | undefined;

/** Lazily built from the environment; null when photo storage is not configured. */
export function getPhotoRuntime(): PhotoRuntime | null {
  if (runtime === undefined) {
    const config = photoConfigFromEnv();
    runtime = config ? { store: new R2PhotoStore(config), publicBaseUrl: config.publicBaseUrl } : null;
    if (!runtime) console.log("Photo storage not configured (R2_* / PHOTO_PUBLIC_BASE_URL) — photo uploads disabled");
  }
  return runtime;
}
