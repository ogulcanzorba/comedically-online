import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { signSession, verifySession } from '../src/auth/session';
import { hashPassword, verifyPassword } from '../src/auth/password';
import { checkRateLimit, resetRateLimits } from '../src/auth/rate-limit';

describe('session cookies', () => {
  it('round-trips a user id', () => {
    const token = signSession('user-123');
    assert.equal(verifySession(token), 'user-123');
  });

  it('rejects tampered signatures', () => {
    const token = signSession('user-123');
    const tampered = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;
    assert.equal(verifySession(tampered), null);
  });

  it('rejects expired sessions', () => {
    process.env.SESSION_SECRET = 'test-secret';
    const body = `${Buffer.from('user-123', 'utf8').toString('base64url')}.${Date.now() - 1000}`;
    const sig = createHmac('sha256', 'test-secret').update(body).digest('hex');
    assert.equal(verifySession(`${body}.${sig}`), null);
    delete process.env.SESSION_SECRET;
  });

  it('rejects malformed tokens', () => {
    assert.equal(verifySession(undefined), null);
    assert.equal(verifySession(''), null);
    assert.equal(verifySession('a.b'), null);
    assert.equal(verifySession('a.b.c.d'), null);
  });
});

describe('passwords', () => {
  it('hashes and verifies (never plaintext-equal)', async () => {
    const hash = await hashPassword('Comedy123!');
    assert.notEqual(hash, 'Comedy123!');
    assert.equal(await verifyPassword('Comedy123!', hash), true);
    assert.equal(await verifyPassword('wrong-pass', hash), false);
  });
});

describe('rate limit', () => {
  beforeEach(() => resetRateLimits());

  it('allows N then blocks inside the window', () => {
    for (let i = 0; i < 10; i++) assert.equal(checkRateLimit('k', 10, 60_000), true);
    assert.equal(checkRateLimit('k', 10, 60_000), false);
  });

  it('resets after the window', () => {
    assert.equal(checkRateLimit('k2', 1, 1), true);
    assert.equal(checkRateLimit('k2', 1, 1), false);
  });
});
