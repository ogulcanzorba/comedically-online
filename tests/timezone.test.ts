import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { localToUtcIso, utcToZonedInput, isValidZone } from '../src/lib/timezone';

describe('timezone conversions', () => {
  it('converts Istanbul wall time (UTC+3, no DST) to UTC', () => {
    assert.equal(localToUtcIso('2026-06-01', '20:00', 'Europe/Istanbul'), '2026-06-01T17:00:00.000Z');
  });

  it('respects DST on both sides (New York)', () => {
    assert.equal(localToUtcIso('2026-07-01', '12:00', 'America/New_York'), '2026-07-01T16:00:00.000Z');
    assert.equal(localToUtcIso('2026-01-01', '12:00', 'America/New_York'), '2026-01-01T17:00:00.000Z');
  });

  it('round-trips through the edit-form prefill', () => {
    const prefill = utcToZonedInput('2026-06-01T17:00:00.000Z', 'Europe/Istanbul');
    assert.deepEqual(prefill, { date: '2026-06-01', time: '20:00' });
  });

  it('rejects bad input', () => {
    assert.equal(localToUtcIso('2026-13-01', '20:00', 'UTC'), null);
    assert.equal(localToUtcIso('2026-06-01', '25:00', 'UTC'), null);
    assert.equal(localToUtcIso('2026-06-01', '20:00', 'Mars/Olympus'), null);
    assert.equal(utcToZonedInput('not-a-date', 'UTC'), null);
    assert.equal(isValidZone('Mars/Olympus'), false);
  });
});
