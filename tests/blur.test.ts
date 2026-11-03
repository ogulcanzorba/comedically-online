import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { blurPx, DEFAULT_BLUR_PX } from '../src/lib/blur';

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k] as string;
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
  }
}

describe('blurPx', () => {
  it('defaults to a strong blur', () => {
    withEnv({ NEXT_PUBLIC_BLUR_PX: undefined, BLUR_PX: undefined }, () => {
      assert.equal(blurPx(), DEFAULT_BLUR_PX);
      assert.ok(DEFAULT_BLUR_PX >= 24);
    });
  });

  it('prefers NEXT_PUBLIC_BLUR_PX, falls back to BLUR_PX', () => {
    withEnv({ NEXT_PUBLIC_BLUR_PX: '40', BLUR_PX: '10' }, () => {
      assert.equal(blurPx(), 40);
    });
    withEnv({ NEXT_PUBLIC_BLUR_PX: undefined, BLUR_PX: '10' }, () => {
      assert.equal(blurPx(), 10);
    });
  });

  it('rejects invalid values', () => {
    withEnv({ NEXT_PUBLIC_BLUR_PX: 'bogus', BLUR_PX: undefined }, () => {
      assert.equal(blurPx(), DEFAULT_BLUR_PX);
    });
    withEnv({ NEXT_PUBLIC_BLUR_PX: '-5', BLUR_PX: undefined }, () => {
      assert.equal(blurPx(), DEFAULT_BLUR_PX);
    });
  });
});
