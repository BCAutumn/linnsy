import type Database from 'better-sqlite3';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ModelSecretsStorePort } from './model-secrets-store-port.js';

interface ModelCredentialRow {
  encrypted_api_key: string;
  nonce: string;
  auth_tag: string;
}

export interface SqliteModelSecretsStoreOptions {
  home?: string;
  masterKey?: Buffer;
  now?: () => number;
}

export class SqliteModelSecretsStore implements ModelSecretsStorePort {
  private readonly getStatement: Database.Statement<[string], ModelCredentialRow>;
  private readonly upsertStatement: Database.Statement<[string, string, string, string, number]>;
  private readonly removeStatement: Database.Statement<[string]>;
  private readonly removeExceptStatement: Database.Statement<[string]>;
  private readonly masterKey: Buffer;
  private readonly now: () => number;

  public constructor(db: Database.Database, options: SqliteModelSecretsStoreOptions = {}) {
    this.masterKey = options.masterKey ?? readOrCreateMasterKey(requireHome(options.home));
    this.now = options.now ?? Date.now;
    this.getStatement = db.prepare<[string], ModelCredentialRow>(
      `SELECT encrypted_api_key, nonce, auth_tag
         FROM model_credentials
       WHERE model_id = ?`
    );
    this.upsertStatement = db.prepare(
      `INSERT INTO model_credentials (model_id, encrypted_api_key, nonce, auth_tag, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(model_id) DO UPDATE SET
         encrypted_api_key = excluded.encrypted_api_key,
         nonce = excluded.nonce,
         auth_tag = excluded.auth_tag,
         updated_at = excluded.updated_at`
    );
    this.removeStatement = db.prepare<[string]>(
      `DELETE FROM model_credentials WHERE model_id = ?`
    );
    this.removeExceptStatement = db.prepare<[string]>(
      `DELETE FROM model_credentials
       WHERE model_id NOT IN (SELECT value FROM json_each(?))`
    );
  }

  public getApiKey(modelId: string): Promise<string | null> {
    return Promise.resolve(this.getApiKeySync(modelId));
  }

  public getApiKeySync(modelId: string): string | null {
    const row = this.getStatement.get(modelId);
    if (row === undefined) {
      return null;
    }
    return decryptApiKey(row, this.masterKey);
  }

  public listApiKeysSync(modelIds: readonly string[]): Map<string, string> {
    const result = new Map<string, string>();
    for (const modelId of modelIds) {
      const apiKey = this.getApiKeySync(modelId);
      if (apiKey !== null) {
        result.set(modelId, apiKey);
      }
    }
    return result;
  }

  public setApiKey(modelId: string, apiKey: string): Promise<void> {
    this.setApiKeySync(modelId, apiKey);
    return Promise.resolve();
  }

  public setApiKeySync(modelId: string, apiKey: string): void {
    const encrypted = encryptApiKey(apiKey, this.masterKey);
    this.upsertStatement.run(modelId, encrypted.ciphertext, encrypted.nonce, encrypted.authTag, this.now());
  }

  public removeApiKey(modelId: string): Promise<boolean> {
    const result = this.removeStatement.run(modelId);
    return Promise.resolve(result.changes > 0);
  }

  public removeApiKeysExcept(modelIds: ReadonlySet<string>): Promise<void> {
    this.removeApiKeysExceptSync(modelIds);
    return Promise.resolve();
  }

  public removeApiKeysExceptSync(modelIds: ReadonlySet<string>): void {
    this.removeExceptStatement.run(JSON.stringify([...modelIds]));
  }
}

function readOrCreateMasterKey(home: string): Buffer {
  const filePath = join(home, 'security', 'model-secrets.key');
  if (existsSync(filePath)) {
    return readFileSync(filePath);
  }

  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const key = randomBytes(32);
  writeFileSync(filePath, key, { mode: 0o600 });
  chmodSync(filePath, 0o600);
  return key;
}

function requireHome(home: string | undefined): string {
  if (home === undefined) {
    throw new Error('model secrets store requires home or masterKey');
  }
  return home;
}

function encryptApiKey(apiKey: string, masterKey: Buffer): {
  ciphertext: string;
  nonce: string;
  authTag: string;
} {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    nonce: nonce.toString('base64'),
    authTag: authTag.toString('base64')
  };
}

function decryptApiKey(row: ModelCredentialRow, masterKey: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(row.nonce, 'base64'));
  decipher.setAuthTag(Buffer.from(row.auth_tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(row.encrypted_api_key, 'base64')),
    decipher.final()
  ]).toString('utf8');
}
