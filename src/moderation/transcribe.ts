import type { ModerationMode, TranscriptTurn } from './types';
import { mockTranscriptFor } from './mock';
import { PRICING } from './cost';
import { startTimeout, voiceTimeoutMs } from './timeout';

const VOICE_URL = 'https://api.meta.ai/v1/asr/transcribe';
const VOICE_MODEL = 'muse-voice-transcribe-1.0';

export interface Transcript {
  text: string;
  turns: TranscriptTurn[];
  /** BCP-47 language tag when the API reports one; otherwise undefined. */
  language?: string;
}

interface VoiceResponse {
  transcript?: string;
  audioDurationMs?: number;
  language?: string;
  detectedLanguage?: string;
  turns?: Array<{ startMs?: number; endMs?: number; transcript?: string }>;
}

function requireKey(): string {
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new Error('MODEL_API_KEY is not set');
  return key;
}

/**
 * Split a PCM WAV into two equal halves (header + PCM each), for timing
 * refinement. Voice returns turn-level times only, so re-transcribing halves
 * localizes a banned word to a ~1s slice instead of the whole 2s chunk.
 * Returns null when the buffer is not a splittable PCM WAV.
 */
export function splitWavHalves(wav: Buffer): [Buffer, Buffer] | null {
  if (wav.length < 44) return null;
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  let blockAlign = 2;
  let dataOff = -1;
  let dataLen = 0;
  let off = 12;
  while (off + 8 <= wav.length) {
    const id = wav.toString('ascii', off, off + 4);
    const len = wav.readUInt32LE(off + 4);
    if (id === 'fmt ' && len >= 16 && off + 8 + 16 <= wav.length) {
      const channels = wav.readUInt16LE(off + 10);
      const bits = wav.readUInt16LE(off + 22);
      if (channels > 0 && bits >= 8) blockAlign = Math.max(1, (channels * bits) / 8);
    }
    if (id === 'data') {
      dataOff = off + 8;
      dataLen = len;
      break;
    }
    off += 8 + len + (len % 2);
  }
  if (dataOff < 0 || dataOff >= wav.length) return null;
  dataLen = Math.min(dataLen, wav.length - dataOff);
  const frames = Math.floor(dataLen / blockAlign);
  if (frames < 2) return null;
  const firstFrames = Math.floor(frames / 2);
  const firstLen = firstFrames * blockAlign;
  const secondLen = dataLen - firstLen;
  const header = wav.subarray(0, dataOff);
  const build = (pcm: Buffer): Buffer => {
    const out = Buffer.alloc(dataOff + pcm.length);
    header.copy(out, 0);
    out.writeUInt32LE(dataOff + pcm.length - 8, 4); // RIFF size = file length - 8
    out.writeUInt32LE(pcm.length, dataOff - 4); // data chunk size
    pcm.copy(out, dataOff);
    return out;
  };
  const pcm = wav.subarray(dataOff, dataOff + dataLen);
  return [build(pcm.subarray(0, firstLen)), build(pcm.subarray(firstLen, firstLen + secondLen))];
}

/** Chunk-relative start (ms) of the second half of a split WAV. */
export function wavHalfBoundaryMs(wav: Buffer): number {
  const halves = splitWavHalves(wav);
  if (!halves) return 1000;
  // Byte rate from the fmt chunk; fall back to 16kHz mono 16-bit.
  let byteRate = 32000;
  let off = 12;
  while (off + 8 <= wav.length) {
    const id = wav.toString('ascii', off, off + 4);
    const len = wav.readUInt32LE(off + 4);
    if (id === 'fmt ' && len >= 16 && off + 8 + 16 <= wav.length) {
      byteRate = wav.readUInt32LE(off + 16) || byteRate;
      break;
    }
    off += 8 + len + (len % 2);
  }
  const firstLen = halves[0].length - headerLen(wav);
  return (firstLen / byteRate) * 1000;
}

function headerLen(wav: Buffer): number {
  let off = 12;
  while (off + 8 <= wav.length) {
    const id = wav.toString('ascii', off, off + 4);
    const len = wav.readUInt32LE(off + 4);
    if (id === 'data') return off + 8;
    off += 8 + len + (len % 2);
  }
  return 44;
}

/** WAV must be mono PCM 16/24kHz (see Meta Voice docs). Null = no audio captured. */
export async function transcribeChunk(
  wav: Buffer | null,
  seq: number,
  mode: ModerationMode,
): Promise<{ transcript: Transcript; costUsd: number }> {
  if (mode === 'mock') {
    return { transcript: mockTranscriptFor(seq), costUsd: 0 };
  }
  if (!wav || wav.length === 0) {
    return { transcript: { text: '', turns: [] }, costUsd: 0 };
  }
  const form = new FormData();
  form.append(
    'request',
    new Blob([JSON.stringify({ model: VOICE_MODEL, audioEncoding: 'WAV', mode: 'ENDPOINTING' })], {
      type: 'application/json',
    }),
  );
  form.append('audio', new Blob([Uint8Array.from(wav)], { type: 'audio/wav' }), 'chunk.wav');
  const t = startTimeout(voiceTimeoutMs());
  let res: Response;
  try {
    res = await fetch(VOICE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${requireKey()}`, Accept: 'application/json' },
      body: form,
      signal: t.signal,
    });
  } finally {
    t.cancel();
  }
  if (!res.ok) {
    throw new Error(`voice transcribe failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as VoiceResponse;
  const turns: TranscriptTurn[] = (body.turns ?? [])
    .filter((t) => typeof t.transcript === 'string' && t.transcript.length > 0)
    .map((t) => ({
      startMs: typeof t.startMs === 'number' ? t.startMs : 0,
      endMs: typeof t.endMs === 'number' ? t.endMs : 2000,
      transcript: t.transcript as string,
    }));
  const text = typeof body.transcript === 'string' ? body.transcript : turns.map((t) => t.transcript).join(' ');
  const ms = typeof body.audioDurationMs === 'number' ? body.audioDurationMs : 2000;
  const language =
    typeof body.language === 'string'
      ? body.language
      : typeof body.detectedLanguage === 'string'
        ? body.detectedLanguage
        : undefined;
  return {
    transcript: { text, turns, ...(language ? { language } : {}) },
    costUsd: (ms / 3_600_000) * PRICING.voiceTranscribePerHourUsd,
  };
}

/**
 * Re-transcribe a wav's two halves in parallel and return their turns with
 * chunk-relative times (second-half turns shifted by the split boundary).
 * Used only after the full-chunk transcript matches an audio rule, to pin
 * the bleep window to ~1s. Each half bills its own audio seconds (cents per
 * hour); callers fall back to full-chunk turns when halves is empty.
 */
export async function transcribeHalves(
  wav: Buffer | null,
  seq: number,
  mode: ModerationMode,
): Promise<{ turns: TranscriptTurn[]; costUsd: number; ms: number }> {
  const start = Date.now();
  if (mode === 'mock' || !wav || wav.length === 0) {
    return { turns: [], costUsd: 0, ms: Date.now() - start };
  }
  const halves = splitWavHalves(wav);
  if (!halves) return { turns: [], costUsd: 0, ms: Date.now() - start };
  const boundaryMs = wavHalfBoundaryMs(wav);
  const [first, second] = await Promise.all([
    transcribeChunk(halves[0], seq, mode),
    transcribeChunk(halves[1], seq, mode),
  ]);
  const turns: TranscriptTurn[] = [
    ...first.transcript.turns,
    ...second.transcript.turns.map((t) => ({
      startMs: t.startMs + boundaryMs,
      endMs: t.endMs + boundaryMs,
      transcript: t.transcript,
    })),
  ];
  return { turns, costUsd: first.costUsd + second.costUsd, ms: Date.now() - start };
}
