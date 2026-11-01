import { createHmac, timingSafeEqual } from 'node:crypto';
import { SESSION_TTL_MS } from './cookie';

let warnedDefault = false;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET is required in production');
  }
  if (!warnedDefault) {
    warnedDefault = true;
    console.warn('[auth] SESSION_SECRET unset; using dev-only default. Set it in .env.');
  }
  return 'dev-only-secret-change-me';
}

/** Stateless signed session: base64url(userId).expiryMs.hexHmac. */
export function signSession(userId: string): string {
  const exp = Date.now() + SESSION_TTL_MS;
  const body = `${Buffer.from(userId, 'utf8').toString('base64url')}.${exp}`;
  const sig = createHmac('sha256', secret()).update(body).digest('hex');
  return `${body}.${sig}`;
}

/** Returns the user id, or null when missing/tampered/expired. */
export function verifySession(value: string | undefined | null): string | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [b64, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  const expected = createHmac('sha256', secret()).update(`${b64}.${expStr}`).digest();
  const actual = Buffer.from(sig, 'hex');
  if (actual.length !== expected.length) return null;
  if (!timingSafeEqual(actual, expected)) return null;
  try {
    return Buffer.from(b64, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}
