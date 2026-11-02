import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { homeFor, homeVariant } from '../src/auth/redirects';
import {
  RULEBOOK_RULES,
  RULEBOOK_VERSION,
  RULEBOOK_VERSION_HASH,
  audioBleepRules,
  videoBlurRules,
} from '../src/moderation/rulebook';
import { getAcceptance, hasValidAcceptance, recordAcceptance } from '../src/db/acceptances';
import { createUser } from '../src/db/users';

describe('auth redirects', () => {
  it('sends logged-in users home, lets logged-out users stay', () => {
    assert.equal(homeFor(null), null);
    assert.equal(homeFor({ role: 'comedian' }), '/studio');
    assert.equal(homeFor({ role: 'viewer' }), '/profile');
  });

  it('picks the home hero variant by role', () => {
    assert.equal(homeVariant(null), 'anon');
    assert.equal(homeVariant({ role: 'viewer' }), 'viewer');
    assert.equal(homeVariant({ role: 'comedian' }), 'comedian');
  });
});

describe('rulebook loading', () => {
  it('loads 3 valid rules: 1 audio + 2 video', () => {
    assert.match(RULEBOOK_VERSION, /^\d+\.\d+\.\d+$/);
    assert.equal(RULEBOOK_RULES.length, 3);
    assert.equal(new Set(RULEBOOK_RULES.map((r) => r.id)).size, 3);
    for (const r of RULEBOOK_RULES) {
      assert.ok(['text', 'video', 'audio'].includes(r.modality));
      assert.ok(['bleep', 'blur', 'block'].includes(r.action));
      assert.ok(['low', 'medium', 'high'].includes(r.severity));
      assert.ok(r.title.length > 0 && r.explanation.length > 0 && r.match.length > 0);
    }
    assert.equal(audioBleepRules().length, 1);
    assert.equal(audioBleepRules()[0].match, 'waffle');
    assert.equal(videoBlurRules().length, 2);
  });

  it('has a stable 12-hex revision hash', () => {
    assert.match(RULEBOOK_VERSION_HASH, /^[0-9a-f]{12}$/);
  });
});

describe('acceptance gate (server side)', () => {
  it('acceptance is valid only for the current revision', () => {
    process.env.SQLITE_FILE = join(tmpdir(), `acceptance-test-${process.pid}.db`);
    createUser({ id: 'u1', role: 'comedian', email: 'u1@example.com', passwordHash: 'x', displayName: 'U1' });
    assert.equal(hasValidAcceptance('u1', RULEBOOK_VERSION_HASH), false);
    recordAcceptance('u1', 'stale-revision');
    assert.equal(hasValidAcceptance('u1', RULEBOOK_VERSION_HASH), false);
    const saved = recordAcceptance('u1', RULEBOOK_VERSION_HASH);
    assert.equal(saved.rulebook_hash, RULEBOOK_VERSION_HASH);
    assert.equal(hasValidAcceptance('u1', RULEBOOK_VERSION_HASH), true);
    assert.deepEqual(getAcceptance('u1')?.rulebook_hash, RULEBOOK_VERSION_HASH);
    assert.equal(hasValidAcceptance('u2', RULEBOOK_VERSION_HASH), false);
  });
});
