import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockTags } from '../src/tags/mock';
import { autoTag } from '../src/tags/index';

describe('mock tagger', () => {
  it('returns 3–6 slug-safe tags', () => {
    const tags = mockTags('My mom, my dad, and the airport', 'A story about family group chats and missed flights.', 'storytelling');
    assert.ok(tags.length >= 3 && tags.length <= 6);
    for (const t of tags) assert.match(t, /^[a-z0-9-]+$/);
  });

  it('hits obvious keywords and the category', () => {
    const tags = mockTags('Landlord Chronicles', 'Rent day, bills, and a sourdough starter.', 'observational');
    assert.ok(tags.includes('money'));
    assert.ok(tags.includes('observational'));
  });

  it('pads thin input with fillers (deterministic)', () => {
    const a = mockTags('Zzz', '', 'improv');
    const b = mockTags('Zzz', '', 'improv');
    assert.deepEqual(a, b);
    assert.ok(a.length >= 3);
  });
});

describe('autoTag', () => {
  it('defaults to mock mode', async () => {
    delete process.env.TAG_MODE;
    const tags = await autoTag('Airport food courts', 'Delayed flights and cold pizza.', 'observational');
    assert.ok(tags.includes('travel'));
    assert.ok(tags.includes('food'));
  });
});
