import { Client, BucketItemStat } from "minio";
import { Readable as ReadableStream } from "stream";

let client: Client | null = null;
let bucketName: string | null = null;
let endpointUrl: string | null = null;

const MinioWrapper = {
  /**
   * Initialize the MinIO client and ensure the bucket exists.
   */
  async init(endpoint: string, accessKey: string, secretKey: string, bucket: string): Promise<void> {
    try {
      const url = new URL(endpoint);
      client = new Client({
        endPoint: url.hostname,
        port: parseInt(url.port, 10) || (url.protocol === "https:" ? 443 : 80),
        useSSL: url.protocol === "https:",
        accessKey,
        secretKey,
      });
      bucketName = bucket;
      endpointUrl = endpoint.replace(/\/+$/, "");

      // Ensure bucket exists
      const exists = await client.bucketExists(bucket);
      if (!exists) {
        await client.makeBucket(bucket);
        console.log(`📦 MinIO bucket "${bucket}" created`);
      }

      // Ensure bucket has a public read-only policy so browsers can
      // fetch files directly via the MinIO URL (GetObject only).
      const publicPolicy = JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Principal: { AWS: ["*"] },
          Action: ["s3:GetObject"],
          Resource: [`arn:aws:s3:::${bucket}/*`],
        }],
      });
      await client.setBucketPolicy(bucket, publicPolicy);

      console.log(`📦 MinIO connected: ${endpoint} (bucket: ${bucket})`);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`📦 MinIO connection failed: ${err.message}`);
      client = null;
      bucketName = null;
      endpointUrl = null;
    }
  },

  /**
   * Whether MinIO is available for use.
   */
  isAvailable(): boolean {
    return client !== null;
  },

  /**
   * Get the base URL for direct public access to objects in the bucket.
   * e.g. "http://<host>:9000/lupos"
   */
  getBucketUrl(): string | null {
    if (!endpointUrl || !bucketName) return null;
    return `${endpointUrl}/${bucketName}`;
  },

  /**
   * Build a direct public URL for an object key.
   */
  getPublicUrl(key: string): string | null {
    const base = this.getBucketUrl();
    if (!base) return null;
    return `${base}/${key}`;
  },

  /**
   * Upload a file buffer to MinIO.
   */
  async upload(key: string, buffer: Buffer, contentType: string): Promise<void> {
    if (!client || !bucketName) throw new Error("MinioWrapper: client not initialized");
    await client.putObject(bucketName, key, buffer, buffer.length, {
      "Content-Type": contentType,
    });
  },

  /**
   * Check if an object exists by key.
   */
  async exists(key: string): Promise<boolean> {
    if (!client || !bucketName) return false;
    try {
      await client.statObject(bucketName, key);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Get object metadata (stat).
   */
  async stat(key: string): Promise<BucketItemStat> {
    if (!client || !bucketName) throw new Error("MinioWrapper: client not initialized");
    return client.statObject(bucketName, key);
  },

  /**
   * Get a readable stream for an object.
   */
  async get(key: string): Promise<ReadableStream> {
    if (!client || !bucketName) throw new Error("MinioWrapper: client not initialized");
    return client.getObject(bucketName, key);
  },

  /**
   * Remove an object from the bucket.
   */
  async remove(key: string): Promise<void> {
    if (!client || !bucketName) throw new Error("MinioWrapper: client not initialized");
    await client.removeObject(bucketName, key);
  },
};

export default MinioWrapper;
