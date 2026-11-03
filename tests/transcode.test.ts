import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractMiddleJpeg,
  preassembleChunk,
  resolveFfmpeg,
  splitMjpegStream,
  webmToMp4,
} from '../src/moderation/transcode';

describe('preassembleChunk', () => {
  it('passes the first chunk through untouched', () => {
    const chunk = Buffer.from('full-clip');
    assert.ok(preassembleChunk(Buffer.from('init'), chunk, true).equals(chunk));
  });

  it('prepends the init segment to later chunks', () => {
    const out = preassembleChunk(Buffer.from('INIT'), Buffer.from('CLUSTER'), false);
    assert.equal(out.toString(), 'INITCLUSTER');
  });

  it('passes later chunks through when no init segment is retained', () => {
    const chunk = Buffer.from('orphan');
    assert.ok(preassembleChunk(null, chunk, false).equals(chunk));
  });
});

describe('resolveFfmpeg', () => {
  it('prefers FFMPEG_PATH', () => {
    const saved = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = '/tmp/fake-ffmpeg-shim';
    try {
      assert.equal(resolveFfmpeg(), '/tmp/fake-ffmpeg-shim');
    } finally {
      if (saved === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = saved;
    }
  });

  it('resolves the bundled binary when no override is set', () => {
    const saved = process.env.FFMPEG_PATH;
    delete process.env.FFMPEG_PATH;
    try {
      assert.ok(resolveFfmpeg());
    } finally {
      if (saved !== undefined) process.env.FFMPEG_PATH = saved;
    }
  });
});

describe('webmToMp4', () => {
  /** Fake ffmpeg: records argv + stdin, emits canned bytes (or fails). */
  function shim(dir: string, mode: 'ok' | 'fail'): string {
    const path = join(dir, `ffmpeg-shim-${mode}.sh`);
    const script =
      mode === 'ok'
        ? `#!/bin/sh\nprintf '%s\n' "$@" > "${dir}/argv.txt"\ncat > "${dir}/stdin.bin"\nprintf 'CANNEDMP4'`
        : `#!/bin/sh\necho 'shim: encode exploded' >&2\nexit 1\n`;
    writeFileSync(path, script);
    chmodSync(path, 0o755);
    return path;
  }

  it('pipes webm in, streams mp4 out, with the SAM-ready encode args', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'transcode-'));
    const out = await webmToMp4(Buffer.from('WEBMBYTES'), shim(dir, 'ok'));
    assert.equal(out.toString(), 'CANNEDMP4');
    assert.equal(readFileSync(join(dir, 'stdin.bin'), 'utf8'), 'WEBMBYTES');
    const argv = readFileSync(join(dir, 'argv.txt'), 'utf8');
    for (const flag of ['libx264', 'scale=640:-2,fps=10', 'mp4', 'pipe:0', 'pipe:1', '-an']) {
      assert.ok(argv.includes(flag), `missing ffmpeg arg: ${flag}`);
    }
  });

  it('rejects with ffmpeg stderr detail on encode failure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'transcode-'));
    await assert.rejects(webmToMp4(Buffer.from('GARBAGE'), shim(dir, 'fail')), /encode exploded/);
  });

  it('rejects when no ffmpeg is available', async () => {
    await assert.rejects(webmToMp4(Buffer.from('x'), null), /no ffmpeg available/);
  });

  it('honors the width override for the confirm call', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'transcode-'));
    await webmToMp4(Buffer.from('WEBMBYTES'), shim(dir, 'ok'), 320);
    const argv = readFileSync(join(dir, 'argv.txt'), 'utf8');
    assert.ok(argv.includes('scale=320:-2,fps=10'), `argv: ${argv}`);
  });
});

describe('splitMjpegStream', () => {
  const soi = Buffer.from([0xff, 0xd8]);
  const eoi = Buffer.from([0xff, 0xd9]);
  const frame = (tag: string) => Buffer.concat([soi, Buffer.from(tag), eoi]);

  it('splits concatenated JPEGs on SOI markers', () => {
    const out = splitMjpegStream(Buffer.concat([frame('A'), frame('B'), frame('C')]));
    assert.equal(out.length, 3);
    assert.ok(out[1].includes('B'));
  });

  it('returns no frames for a stream without SOI markers', () => {
    assert.deepEqual(splitMjpegStream(Buffer.from('not-jpeg')), []);
  });
});

describe('extractMiddleJpeg', () => {
  function jpegShim(dir: string, payload: Buffer): string {
    const path = join(dir, 'ffmpeg-jpeg.sh');
    const script =
      `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/argv.txt"\ncat > "${dir}/stdin.bin"\n` +
      `printf '${payload.toString('base64')}' | base64 -d`;
    writeFileSync(path, script);
    chmodSync(path, 0o755);
    return path;
  }
  const soi = Buffer.from([0xff, 0xd8]);
  const eoi = Buffer.from([0xff, 0xd9]);
  const frame = (tag: string) => Buffer.concat([soi, Buffer.from(tag), eoi]);

  it('returns the middle frame of the decoded window at 320px', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'transcode-'));
    const out = await extractMiddleJpeg(
      Buffer.from('WEBMBYTES'),
      jpegShim(dir, Buffer.concat([frame('F0'), frame('F1'), frame('F2'), frame('F3')])),
    );
    assert.ok(out.includes('F2'), `picked: ${out.toString()}`);
    const argv = readFileSync(join(dir, 'argv.txt'), 'utf8');
    for (const flag of ['scale=320:-2', 'image2pipe', 'mjpeg', 'pipe:0', 'pipe:1']) {
      assert.ok(argv.includes(flag), `missing ffmpeg arg: ${flag}`);
    }
    assert.equal(readFileSync(join(dir, 'stdin.bin'), 'utf8'), 'WEBMBYTES');
  });

  it('rejects when the window decodes to zero frames', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'transcode-'));
    await assert.rejects(
      extractMiddleJpeg(Buffer.from('WEBMBYTES'), jpegShim(dir, Buffer.from('nojpeg'))),
      /zero frames/,
    );
  });

  it('rejects when no ffmpeg is available', async () => {
    await assert.rejects(extractMiddleJpeg(Buffer.from('x'), null), /no ffmpeg available/);
  });
});
