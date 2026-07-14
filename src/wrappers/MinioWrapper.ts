// ─── MinIO Wrapper ──────────────────────────────────────────
// Delegates to @rodrigo-barraza/utilities-library/service/minio.
// Preserves the MinioWrapper.init(endpoint, ak, sk, bucket)
// positional-arg interface that lupos-bot consumers expect.
// ─────────────────────────────────────────────────────────────

import { MinioManager } from "@rodrigo-barraza/utilities-library/service/minio";
import type { BucketItemStat } from "minio";
import type { Readable } from "stream";

const MinioWrapper = {
  async init(endpoint: string, accessKey: string, secretKey: string, bucket: string): Promise<void> {
    await MinioManager.init({
      endpoint,
      accessKey,
      secretKey,
      bucket,
      publicRead: true,
    });
  },

  isAvailable(): boolean {
    return MinioManager.isAvailable();
  },

  getBucketUrl(): string | null {
    return MinioManager.getBucketUrl();
  },

  getPublicUrl(key: string): string | null {
    return MinioManager.getPublicUrl(key);
  },

  async upload(key: string, buffer: Buffer, contentType: string): Promise<void> {
    return MinioManager.upload(key, buffer, contentType);
  },

  async exists(key: string): Promise<boolean> {
    try {
      await MinioManager.stat(key);
      return true;
    } catch {
      return false;
    }
  },

  async stat(key: string): Promise<BucketItemStat> {
    return MinioManager.stat(key);
  },

  async get(key: string): Promise<Readable> {
    return MinioManager.get(key);
  },

  async remove(key: string): Promise<void> {
    return MinioManager.remove(key);
  },
};

export default MinioWrapper;
