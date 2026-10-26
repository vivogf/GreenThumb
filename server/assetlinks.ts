import type { Request, Response } from "express";

export const DEBUG_PACKAGE = "com.greenthumbplantcare.debug";
export const RELEASE_PACKAGE = "com.greenthumbplantcare";

const RELATIONS = [
  "delegate_permission/common.handle_all_urls",
  "delegate_permission/common.get_login_creds",
];
const FINGERPRINT_PATTERN = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export interface AssetLinkStatement {
  relation: string[];
  target: {
    namespace: "android_app";
    package_name: string;
    sha256_cert_fingerprints: string[];
  };
}

export type AssetLinksEnv = Record<string, string | undefined>;

// Comma- or whitespace-separated list; anything that is not a 32-byte SHA-256 is dropped.
export function parseFingerprints(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(/[\s,]+/)) {
    const value = part.trim().toUpperCase();
    if (FINGERPRINT_PATTERN.test(value)) seen.add(value);
  }
  return Array.from(seen);
}

export function buildAssetLinks(env: AssetLinksEnv): AssetLinkStatement[] {
  const packages: Array<[string, string[]]> = [
    [DEBUG_PACKAGE, parseFingerprints(env.ASSETLINKS_FINGERPRINTS_DEBUG)],
    [RELEASE_PACKAGE, parseFingerprints(env.ASSETLINKS_FINGERPRINTS_RELEASE)],
  ];
  return packages
    .filter(([, fingerprints]) => fingerprints.length > 0)
    .map(([packageName, fingerprints]) => ({
      relation: [...RELATIONS],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    }));
}

export function createAssetLinksHandler(getEnv: () => AssetLinksEnv = () => process.env) {
  return (_req: Request, res: Response) => {
    res.set("Cache-Control", "public, max-age=300");
    res.type("application/json").send(JSON.stringify(buildAssetLinks(getEnv())));
  };
}
