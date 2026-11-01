import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { showStatus, minPrice, isSoldOut, formatCents } from '../src/lib/datetime';

describe('showStatus', () => {
  const start = '2026-12-01T20:00:00.000Z';
  it('is upcoming before start, live during, ended after', () => {
    assert.equal(showStatus(start, 60, Date.parse('2026-12-01T19:59:59.000Z')), 'upcoming');
    assert.equal(showStatus(start, 60, Date.parse(start)), 'live');
    assert.equal(showStatus(start, 60, Date.parse('2026-12-01T20:59:59.000Z')), 'live');
    assert.equal(showStatus(start, 60, Date.parse('2026-12-01T21:00:00.000Z')), 'ended');
  });
});

describe('pricing helpers', () => {
  it('minPrice finds the cheapest tier', () => {
    assert.equal(
      minPrice([
        { id: 'a', name: 'A', price_cents: 900 },
        { id: 'b', name: 'B', price_cents: 500 },
      ]),
      500,
    );
    assert.equal(minPrice([]), null);
  });

  it('isSoldOut only when every capped tier is full', () => {
    const tiers = [
      { id: 'a', name: 'A', price_cents: 800, cap: 2 },
      { id: 'b', name: 'B', price_cents: 100 },
    ];
    assert.equal(isSoldOut(tiers, { a: 2 }), false); // uncapped tier still open
    assert.equal(isSoldOut([tiers[0]], { a: 1 }), false);
    assert.equal(isSoldOut([tiers[0]], { a: 2 }), true);
    assert.equal(isSoldOut([], {}), false);
  });

  it('formatCents renders Free and dollars', () => {
    assert.equal(formatCents(0), 'Free');
    assert.equal(formatCents(500), '$5');
    assert.equal(formatCents(1250), '$12.50');
  });
});
