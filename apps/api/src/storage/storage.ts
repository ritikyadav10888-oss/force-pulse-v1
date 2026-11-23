import { Storage } from '@google-cloud/storage';
import { Global, Injectable, Module } from '@nestjs/common';

export interface StoredObject {
  size: number;
  contentType: string;
}

/** Private file storage with short-lived signed links. Abstract so tests use an in-memory fake. */
export abstract class FileStorage {
  /** Signed PUT URL; the client must send the returned headers. Size is capped by storage itself. */
  abstract presignUpload(
    key: string,
    contentType: string,
    maxBytes: number,
    ttlSeconds: number,
  ): Promise<{ url: string; headers: Record<string, string> }>;
  abstract presignDownload(key: string, ttlSeconds: number): Promise<string>;
  abstract stat(key: string): Promise<StoredObject | null>;
  abstract delete(key: string): Promise<void>;
}

/**
 * Google Cloud Storage. On Cloud Run, URLs are signed through IAM signBlob with the service's own
 * identity (needs roles/iam.serviceAccountTokenCreator on itself), so no key file exists anywhere.
 */
@Injectable()
export class GcsStorage extends FileStorage {
  private cached?: ReturnType<Storage['bucket']>;
  // Lazy, so the API still boots without FILES_BUCKET (local dev); only uploads fail.
  private get bucket() {
    return (this.cached ??= new Storage().bucket(requireEnv('FILES_BUCKET')));
  }

  async presignUpload(key: string, contentType: string, maxBytes: number, ttlSeconds: number) {
    const headers = { 'Content-Type': contentType, 'x-goog-content-length-range': `0,${maxBytes}` };
    const [url] = await this.bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + ttlSeconds * 1000,
      contentType,
      extensionHeaders: { 'x-goog-content-length-range': headers['x-goog-content-length-range'] },
    });
    return { url, headers };
  }

  async presignDownload(key: string, ttlSeconds: number) {
    const [url] = await this.bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + ttlSeconds * 1000,
    });
    return url;
  }

  async stat(key: string) {
    const [exists] = await this.bucket.file(key).exists();
    if (!exists) return null;
    const [meta] = await this.bucket.file(key).getMetadata();
    return { size: Number(meta.size), contentType: meta.contentType ?? '' };
  }

  async delete(key: string) {
    await this.bucket.file(key).delete({ ignoreNotFound: true });
  }
}

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

@Global()
@Module({ providers: [{ provide: FileStorage, useClass: GcsStorage }], exports: [FileStorage] })
export class StorageModule {}
