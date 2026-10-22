import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db.js';
import { now } from './db.js';
import { getSetting, setSetting } from './settings.js';

export const SESSION_COOKIE = 'romsafe_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PAIRING_TTL_MS = 10 * 60 * 1000;

export const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (): string => crypto.randomBytes(32).toString('base64url');

export interface DeviceRow {
  id: number;
  name: string;
  kind: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    device?: DeviceRow;
    isAdmin?: boolean;
  }
}

// --- admin password -------------------------------------------------------

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyHash(password: string, stored: string): boolean {
  const [scheme, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 32);
  return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
}

export class Auth {
  constructor(
    private db: Db,
    private envPassword: string | undefined,
  ) {}

  /** True until an admin password exists (from the environment or first-run setup). */
  setupRequired(): boolean {
    return !this.envPassword && !getSetting(this.db, 'admin_password_hash');
  }

  setPassword(password: string): void {
    setSetting(this.db, 'admin_password_hash', hashPassword(password));
  }

  checkPassword(password: string): boolean {
    if (this.envPassword) {
      const a = Buffer.from(sha256(password));
      const b = Buffer.from(sha256(this.envPassword));
      return crypto.timingSafeEqual(a, b);
    }
    const stored = getSetting(this.db, 'admin_password_hash');
    return !!stored && verifyHash(password, stored);
  }

  createSession(): string {
    const token = randomToken();
    this.db.run('DELETE FROM sessions WHERE expires_at < $now', { $now: now() });
    this.db.run('INSERT INTO sessions (token_hash, expires_at) VALUES ($h, $e)', {
      $h: sha256(token),
      $e: now() + SESSION_TTL_MS,
    });
    return token;
  }

  destroySession(token: string): void {
    this.db.run('DELETE FROM sessions WHERE token_hash = $h', { $h: sha256(token) });
  }

  sessionValid(token: string | undefined): boolean {
    if (!token) return false;
    const row = this.db.get<{ expires_at: number }>('SELECT expires_at FROM sessions WHERE token_hash = $h', {
      $h: sha256(token),
    });
    return !!row && row.expires_at > now();
  }

  // --- devices ------------------------------------------------------------

  createPairingCode(): { code: string; expiresAt: number } {
    // Short, unambiguous code a person can type on a phone.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(8);
    const code = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    const expiresAt = now() + PAIRING_TTL_MS;
    this.db.run('DELETE FROM pairing_codes WHERE expires_at < $now', { $now: now() });
    this.db.run('INSERT INTO pairing_codes (code, expires_at) VALUES ($c, $e)', { $c: code, $e: expiresAt });
    return { code, expiresAt };
  }

  /** Exchange a pairing code for a long-lived device token. */
  pair(code: string, name: string, kind: string): { device: DeviceRow; token: string } | null {
    return this.db.tx(() => {
      const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const row = this.db.get<{ expires_at: number }>('SELECT expires_at FROM pairing_codes WHERE code = $c', {
        $c: normalized,
      });
      if (!row || row.expires_at < now()) return null;
      this.db.run('DELETE FROM pairing_codes WHERE code = $c', { $c: normalized });
      const token = randomToken();
      const { lastId } = this.db.run(
        'INSERT INTO devices (name, kind, token_hash, created_at, last_seen_at) VALUES ($n, $k, $h, $t, $t)',
        { $n: name, $k: kind, $h: sha256(token), $t: now() },
      );
      return { device: { id: lastId, name, kind }, token };
    });
  }

  deviceForToken(token: string): DeviceRow | undefined {
    const device = this.db.get<DeviceRow>('SELECT id, name, kind FROM devices WHERE token_hash = $h', {
      $h: sha256(token),
    });
    if (device) this.db.run('UPDATE devices SET last_seen_at = $t WHERE id = $id', { $t: now(), $id: device.id });
    return device;
  }

  // --- request guards -------------------------------------------------------

  /** Resolve who is calling: an admin (session cookie) or a device (bearer token). */
  identify(req: FastifyRequest): void {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      req.device = this.deviceForToken(header.slice(7).trim());
    }
    req.isAdmin = this.sessionValid(req.cookies?.[SESSION_COOKIE]);
  }
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.isAdmin) await reply.code(401).send({ error: 'Not signed in' });
}

export async function requireDevice(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.device) await reply.code(401).send({ error: 'Unknown or revoked device token' });
}

export async function requireAdminOrDevice(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.isAdmin && !req.device) await reply.code(401).send({ error: 'Unauthorized' });
}
