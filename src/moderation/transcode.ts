import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import ffmpegStatic from 'ffmpeg-static';

/** Transcode budget per 2s chunk (ms). Small clips finish in well under a second. */
export const TRANSCODE_TIMEOUT_MS = 15_000;

/**
 * Resolve an ffmpeg binary: FFMPEG_PATH first, then the ffmpeg-static bundle,
 * then a system ffmpeg on PATH. Null when none is available.
 */
export function resolveFfmpeg(): string | null {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (typeof ffmpegStatic === 'string' && ffmpegStatic.length > 0 && existsSync(ffmpegStatic)) {
    return ffmpegStatic;
  }
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return 'ffmpeg';
  } catch {
    return null;
  }
}

/**
 * Make a MediaRecorder timeslice chunk standalone. Chunks after the first are
 * bare clusters without the WebM header, so the retained init segment is
 * prepended (exactly what MSE appends for playback). The first chunk already
 * carries the header and passes through untouched.
 */
export function preassembleChunk(
  initSegment: Buffer | null,
  chunk: Buffer,
  isFirst: boolean,
): Buffer {
  if (isFirst || !initSegment || initSegment.length === 0) return chunk;
  return Buffer.concat([initSegment, chunk]);
}

/**
 * Convert one 2s WebM window to MP4 (H.264, no audio, 10fps, width px wide)
 * for SAM, which rejects WebM. Reads from stdin, writes a fragmented MP4
 * suitable for piping to stdout. Throws on missing ffmpeg, timeout, or
 * encode failure.
 */
export function webmToMp4(
  webm: Buffer,
  ffmpeg = resolveFfmpeg(),
  width = 640,
): Promise<Buffer> {
  const bin = ffmpeg;
  if (!bin) {
    return Promise.reject(new Error('no ffmpeg available (FFMPEG_PATH, ffmpeg-static, or system ffmpeg)'));
  }
  return new Promise<Buffer>((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-vf',
      `scale=${width}:-2,fps=10`,
      '-movflags',
      'frag_keyframe+empty_moov',
      '-f',
      'mp4',
      'pipe:1',
    ];
    const child = spawn(bin, args, { signal: AbortSignal.timeout(TRANSCODE_TIMEOUT_MS) });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', (e) => reject(new Error(`ffmpeg failed to start: ${e.message}`)));
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve(Buffer.concat(out));
        return;
      }
      const detail = Buffer.concat(err).toString('utf8').trim().slice(0, 300);
      reject(
        new Error(
          `ffmpeg transcode failed (code ${code ?? '?'}${signal ? `, ${signal}` : ''})${detail ? `: ${detail}` : ''}`,
        ),
      );
    });
    child.stdin.on('error', () => {
      // stdin breaks when ffmpeg exits early on invalid input; close carries the error.
    });
    child.stdin.end(webm);
  });
}

/**
 * Split a concatenated JPEG stream (ffmpeg image2pipe) into its frames.
 * Splits on SOI markers only: each frame runs to the next SOI (or EOF), so
 * EOI-looking byte pairs inside entropy data can never corrupt the split.
 */
export function splitMjpegStream(stream: Buffer): Buffer[] {
  const starts: number[] = [];
  for (let i = 0; i + 1 < stream.length; i++) {
    if (stream[i] === 0xff && stream[i + 1] === 0xd8) starts.push(i);
  }
  return starts.map((from, i) => stream.subarray(from, i + 1 < starts.length ? starts[i + 1] : stream.length));
}

/**
 * Extract the middle frame of one 2s WebM window as a 320px JPEG for SAM
 * image segmentation. Middle-by-count is timestamp-agnostic (MediaRecorder
 * timeslice chunks carry absolute stream timestamps, so `-ss 1.0` would
 * misfire on every chunk past the first) and lands at t≈1.0s for uniform
 * frame rates. Throws on missing ffmpeg, timeout, encode failure, or when
 * the window decodes to zero frames.
 */
export function extractMiddleJpeg(webm: Buffer, ffmpeg = resolveFfmpeg()): Promise<Buffer> {
  const bin = ffmpeg;
  if (!bin) {
    return Promise.reject(new Error('no ffmpeg available (FFMPEG_PATH, ffmpeg-static, or system ffmpeg)'));
  }
  return new Promise<Buffer>((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-vf',
      'scale=320:-2',
      '-q:v',
      '4',
      '-f',
      'image2pipe',
      '-c:v',
      'mjpeg',
      'pipe:1',
    ];
    const child = spawn(bin, args, { signal: AbortSignal.timeout(TRANSCODE_TIMEOUT_MS) });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', (e) => reject(new Error(`ffmpeg failed to start: ${e.message}`)));
    child.on('close', (code, signal) => {
      if (code !== 0) {
        const detail = Buffer.concat(err).toString('utf8').trim().slice(0, 300);
        reject(
          new Error(
            `ffmpeg jpeg extract failed (code ${code ?? '?'}${signal ? `, ${signal}` : ''})${detail ? `: ${detail}` : ''}`,
          ),
        );
        return;
      }
      const frames = splitMjpegStream(Buffer.concat(out));
      if (frames.length === 0) {
        reject(new Error('ffmpeg jpeg extract failed: window decoded to zero frames'));
        return;
      }
      resolve(frames[Math.floor(frames.length / 2)]);
    });
    child.stdin.on('error', () => {
      // stdin breaks when ffmpeg exits early on invalid input; close carries the error.
    });
    child.stdin.end(webm);
  });
}
