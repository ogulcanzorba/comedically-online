import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitWavHalves,
  transcribeHalves,
  wavHalfBoundaryMs,
} from '../src/moderation/transcribe';
import { bleepWindowsForTarget } from '../src/moderation/index';

/** Minimal valid 16kHz mono 16-bit PCM WAV with a ramp payload. */
function makeWav(seconds: number): Buffer {
  const sampleRate = 16000;
  const pcmLen = Math.floor(seconds * sampleRate) * 2;
  const out = Buffer.alloc(44 + pcmLen);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + pcmLen, 4);
  out.write('WAVE', 8);
  out.write('fmt ', 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(1, 22); // mono
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28);
  out.writeUInt16LE(2, 32); // block align
  out.writeUInt16LE(16, 34); // bits
  out.write('data', 36);
  out.writeUInt32LE(pcmLen, 40);
  for (let i = 0; i < pcmLen; i++) out[44 + i] = i % 251;
  return out;
}

describe('splitWavHalves', () => {
  it('splits a 2s WAV into two valid WAVs that rejoin exactly', () => {
    const wav = makeWav(2);
    const halves = splitWavHalves(wav);
    assert.ok(halves);
    const [first, second] = halves;
    for (const h of [first, second]) {
      assert.equal(h.toString('ascii', 0, 4), 'RIFF');
      assert.equal(h.toString('ascii', 8, 12), 'WAVE');
      assert.equal(h.readUInt32LE(4), h.length - 8);
      assert.equal(h.toString('ascii', 36, 40), 'data');
      assert.equal(h.readUInt32LE(40), h.length - 44);
    }
    const rejoined = Buffer.concat([first.subarray(44), second.subarray(44)]);
    assert.ok(rejoined.equals(wav.subarray(44)));
    assert.equal(first.length, second.length);
  });

  it('rejects buffers that are not splittable WAVs', () => {
    assert.equal(splitWavHalves(Buffer.alloc(10)), null);
    assert.equal(splitWavHalves(Buffer.alloc(100)), null);
    const bad = makeWav(1);
    bad.write('RIFX', 0);
    assert.equal(splitWavHalves(bad), null);
  });

  it('reports the half boundary at ~1000ms for a 2s chunk', () => {
    const ms = wavHalfBoundaryMs(makeWav(2));
    assert.ok(Math.abs(ms - 1000) < 1, `boundary ${ms}ms`);
  });
});

describe('transcribeHalves', () => {
  it('returns empty turns in mock mode without network', async () => {
    const r = await transcribeHalves(makeWav(2), 7, 'mock');
    assert.deepEqual(r.turns, []);
    assert.equal(r.costUsd, 0);
  });

  it('returns empty turns for missing audio', async () => {
    const r = await transcribeHalves(null, 7, 'live');
    assert.deepEqual(r.turns, []);
  });
});

describe('bleep windows from half turns', () => {
  it('pins a word found in the second half inside [1000, 2000]', () => {
    const windows = bleepWindowsForTarget(
      [{ startMs: 1000, endMs: 2000, transcript: 'then I ate a waffle' }],
      'waffle',
    );
    assert.equal(windows.length, 1);
    assert.ok(windows[0].startMs >= 1000, `start ${windows[0].startMs}`);
    assert.ok(windows[0].endMs <= 2000, `end ${windows[0].endMs}`);
    assert.ok(windows[0].endMs - windows[0].startMs < 1000);
  });

  it('rounds fractional half-chunk turn offsets to integer ms', () => {
    const windows = bleepWindowsForTarget(
      [{ startMs: 1072.0625, endMs: 1800.0625, transcript: 'waffles' }],
      'waffles',
    );
    assert.equal(windows.length, 1);
    assert.equal(windows[0].startMs, 1072);
    assert.equal(windows[0].endMs, 1800);
  });
});
