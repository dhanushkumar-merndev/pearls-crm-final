// StorageAdapter: the ONLY place that talks to the private file store (Tigris in
// production, MinIO locally). S3 API, so the provider can change by config alone.
// Keys never leave the server; clients only ever get short-lived signed links.
import { AwsClient } from "aws4fetch";

export interface StorageConfig {
  endpoint: string; // e.g. https://t3.storage.dev (Tigris) or http://127.0.0.1:9000 (MinIO)
  region: string; // "auto" for Tigris
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  // false (default): https://<bucket>.<host>/key, where Tigris applies the bucket's CORS rules.
  // true: https://<host>/<bucket>/key, for MinIO. Tigris answers CORS with "*" on this form.
  pathStyle?: boolean;
}

export interface ObjectInfo {
  size: number;
  contentType: string | null;
}

export interface StorageAdapter {
  presignPut(key: string, contentType: string, expiresSec: number): Promise<string>;
  presignGet(key: string, expiresSec: number): Promise<string>;
  head(key: string): Promise<ObjectInfo | null>;
  readRange(key: string, start: number, endInclusive: number): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
}

const encodeKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");

export function s3Storage(cfg: StorageConfig, datetime?: string): StorageAdapter {
  const aws = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: "s3",
    region: cfg.region,
  });
  const endpoint = new URL(cfg.endpoint);
  const base = cfg.pathStyle
    ? `${endpoint.origin}/${cfg.bucket}`
    : `${endpoint.protocol}//${cfg.bucket}.${endpoint.host}`;
  const objectUrl = (key: string) => `${base}/${encodeKey(key)}`;

  async function presign(method: "GET" | "PUT", key: string, expiresSec: number, headers: Record<string, string> = {}) {
    const url = new URL(objectUrl(key));
    url.searchParams.set("X-Amz-Expires", String(expiresSec));
    const signed = await aws.sign(url.toString(), {
      method,
      headers,
      // allHeaders: content-type is signed, so the link only works for the approved file type.
      aws: { signQuery: true, allHeaders: true, ...(datetime ? { datetime } : {}) },
    });
    return signed.url;
  }

  return {
    presignPut: (key, contentType, expiresSec) => presign("PUT", key, expiresSec, { "content-type": contentType }),
    presignGet: (key, expiresSec) => presign("GET", key, expiresSec),
    async head(key) {
      const res = await aws.fetch(objectUrl(key), { method: "HEAD" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`storage_head_${res.status}`);
      return { size: Number(res.headers.get("content-length") ?? 0), contentType: res.headers.get("content-type") };
    },
    async readRange(key, start, endInclusive) {
      const res = await aws.fetch(objectUrl(key), { headers: { range: `bytes=${start}-${endInclusive}` } });
      if (!res.ok) throw new Error(`storage_get_${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async remove(key) {
      const res = await aws.fetch(objectUrl(key), { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`storage_delete_${res.status}`);
    },
  };
}

export function storageFromEnv(): StorageAdapter {
  const get = (name: string) => {
    const value = Deno.env.get(name);
    if (!value) throw new Error(`missing_env_${name}`);
    return value;
  };
  return s3Storage({
    endpoint: get("STORAGE_ENDPOINT"),
    region: Deno.env.get("STORAGE_REGION") ?? "auto",
    bucket: get("STORAGE_BUCKET"),
    accessKeyId: get("STORAGE_ACCESS_KEY_ID"),
    secretAccessKey: get("STORAGE_SECRET_ACCESS_KEY"),
    pathStyle: Deno.env.get("STORAGE_PATH_STYLE") === "true",
  });
}
