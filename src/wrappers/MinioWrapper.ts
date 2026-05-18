import { Client } from "minio";

let client: any = null;
let bucketName: string | null = null;
let endpointUrl: string | null = null;

const MinioWrapper = {
  /**
   * Initialize the MinIO client and ensure the bucket exists.


   */
  async init(endpoint: any, accessKey: any, secretKey: any, bucket: any) {
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
    } catch (error: any) {
      console.error(`📦 MinIO connection failed: ${error.message}`);
      client = null;
      bucketName = null;
      endpointUrl = null;
    }
  },

  /**
   * Whether MinIO is available for use.
   */
  isAvailable() {
    return client !== null;
  },

  /**
   * Get the base URL for direct public access to objects in the bucket.
   * e.g. "http://<host>:9000/lupos"

   */
  getBucketUrl() {
    if (!endpointUrl || !bucketName) return null;
    return `${endpointUrl}/${bucketName}`;
  },

  /**
   * Build a direct public URL for an object key.


   */
  getPublicUrl(key: any) {
    const base = this.getBucketUrl();
    if (!base) return null;
    return `${base}/${key}`;
  },

  /**
   * Upload a file buffer to MinIO.


   */
  async upload(key: any, buffer: any, contentType: any) {
    await client.putObject(bucketName, key, buffer, buffer.length, {
      "Content-Type": contentType,
    });
  },

  /**
   * Check if an object exists by key.


   */
  async exists(key: any) {
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
  async stat(key: any) {
    return client.statObject(bucketName, key);
  },

  /**
   * Get a readable stream for an object.


   */
  async get(key: any) {
    return client.getObject(bucketName, key);
  },

  /**
   * Remove an object from the bucket.


   */
  async remove(key: any) {
    await client.removeObject(bucketName, key);
  },
};

export default MinioWrapper;
