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
 * Convert one 2s WebM window to MP4 (H.264, no audio, 640px wide, 10fps) for
 * SAM, which rejects WebM. Reads from stdin, writes a fragmented MP4 suitable
 * for piping to stdout. Throws on missing ffmpeg, timeout, or encode failure.
 */
export function webmToMp4(webm: Buffer, ffmpeg = resolveFfmpeg()): Promise<Buffer> {
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
      'scale=640:-2,fps=10',
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
