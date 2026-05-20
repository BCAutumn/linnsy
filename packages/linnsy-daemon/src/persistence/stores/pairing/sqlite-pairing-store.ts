import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';

import type { Platform } from '../../../shared/messaging.js';
import type { PairingStorePort } from './pairing-store-port.js';

export interface SqlitePairingStoreOptions {
  pairingIdFactory?: () => string;
  saltFactory?: () => Buffer;
}

interface PairingCandidateRow {
  pairing_id: string;
  code_hash: string;
}

interface HasAuthorizedRow {
  found: number;
}

type CreatePairingParams = [
  string,
  string,
  string,
  string | null,
  string,
  number,
  number
];

type ConsumePairingParams = [number, string, string, string | null, string];
type IncrementAttemptsParams = [string];

export class SqlitePairingStore implements PairingStorePort {
  private readonly pairingIdFactory: () => string;
  private readonly saltFactory: () => Buffer;
  private readonly insertStatement: Database.Statement<CreatePairingParams>;
  private readonly candidatesStatement: Database.Statement<
    [number, number, string, string, string | null],
    PairingCandidateRow
  >;
  private readonly consumeStatement: Database.Statement<ConsumePairingParams>;
  private readonly incrementAttemptsStatement: Database.Statement<IncrementAttemptsParams>;
  private readonly hasAuthorizedWithUserStatement: Database.Statement<[string, string, string], HasAuthorizedRow>;
  private readonly hasAuthorizedWithoutUserStatement: Database.Statement<[string, string], HasAuthorizedRow>;

  public constructor(private readonly db: Database.Database, options: SqlitePairingStoreOptions = {}) {
    this.pairingIdFactory = options.pairingIdFactory ?? defaultPairingIdFactory;
    this.saltFactory = options.saltFactory ?? defaultSaltFactory;
    this.insertStatement = db.prepare(
      `INSERT INTO pairings (
         pairing_id,
         channel,
         chat_id,
         user_id,
         code_hash,
         expires_at,
         created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    this.candidatesStatement = db.prepare(
      `SELECT pairing_id, code_hash
       FROM pairings
       WHERE consumed_at IS NULL
         AND expires_at > ?
         AND attempts < ?
         AND (channel = ? OR channel = '*')
         AND (chat_id = ? OR chat_id = '*')
         AND (user_id IS NULL OR user_id = ?)
       ORDER BY created_at DESC`
    );
    this.consumeStatement = db.prepare(
      `UPDATE pairings
       SET consumed_at = ?,
           channel = ?,
           chat_id = ?,
           user_id = ?
       WHERE pairing_id = ? AND consumed_at IS NULL`
    );
    this.incrementAttemptsStatement = db.prepare(
      `UPDATE pairings
       SET attempts = attempts + 1
       WHERE pairing_id = ? AND consumed_at IS NULL`
    );
    this.hasAuthorizedWithUserStatement = db.prepare(
      `SELECT 1 AS found
       FROM pairings
       WHERE channel = ?
         AND chat_id = ?
         AND consumed_at IS NOT NULL
         AND (user_id IS NULL OR user_id = ?)
       LIMIT 1`
    );
    this.hasAuthorizedWithoutUserStatement = db.prepare(
      `SELECT 1 AS found
       FROM pairings
       WHERE channel = ?
         AND chat_id = ?
         AND consumed_at IS NOT NULL
         AND user_id IS NULL
       LIMIT 1`
    );
  }

  public hasAuthorizedPairing(input: {
    platform: Platform;
    chatId: string;
    userId?: string;
  }): Promise<boolean> {
    const row = input.userId === undefined
      ? this.hasAuthorizedWithoutUserStatement.get(String(input.platform), input.chatId)
      : this.hasAuthorizedWithUserStatement.get(String(input.platform), input.chatId, input.userId);
    return Promise.resolve(row !== undefined);
  }

  public createPairing(input: {
    platform: Platform;
    chatId: string;
    userId?: string;
    code: string;
    expiresAt: number;
    createdAt: number;
  }): Promise<void> {
    return Promise.resolve().then(() => {
      this.insertStatement.run(
        this.pairingIdFactory(),
        String(input.platform),
        input.chatId,
        input.userId ?? null,
        hashPairingCode(input.code, this.saltFactory()),
        input.expiresAt,
        input.createdAt
      );
    });
  }

  public consumePairingCode(input: {
    code: string;
    platform: Platform;
    chatId: string;
    userId?: string;
    now: number;
    maxAttempts: number;
  }): Promise<boolean> {
    return Promise.resolve().then(() => {
      const candidates = this.candidatesStatement.all(
        input.now,
        input.maxAttempts,
        String(input.platform),
        input.chatId,
        input.userId ?? null
      );

      for (const candidate of candidates) {
        if (verifyPairingCode(input.code, candidate.code_hash)) {
          const result = this.consumeStatement.run(
            input.now,
            String(input.platform),
            input.chatId,
            input.userId ?? null,
            candidate.pairing_id
          );
          return result.changes > 0;
        }
      }

      for (const candidate of candidates) {
        this.incrementAttemptsStatement.run(candidate.pairing_id);
      }
      return false;
    });
  }
}

function defaultPairingIdFactory(): string {
  return `pair_${randomUUID()}`;
}

function defaultSaltFactory(): Buffer {
  return randomBytes(16);
}

function hashPairingCode(code: string, salt: Buffer): string {
  const derived = scryptSync(code, salt, 32);
  return `scrypt:v1:${salt.toString('base64url')}:${derived.toString('base64url')}`;
}

function verifyPairingCode(code: string, encodedHash: string): boolean {
  const parts = encodedHash.split(':');
  if (parts.length !== 4 || parts[0] !== 'scrypt' || parts[1] !== 'v1') {
    return false;
  }
  const saltEncoded = parts[2];
  const expectedEncoded = parts[3];
  if (saltEncoded === undefined || expectedEncoded === undefined) {
    return false;
  }
  const salt = Buffer.from(saltEncoded, 'base64url');
  const expected = Buffer.from(expectedEncoded, 'base64url');
  const actual = scryptSync(code, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
