import type { ModerationMode, TranscriptTurn } from './types';
import { mockTranscriptFor } from './mock';
import { PRICING } from './cost';
import { startTimeout } from './timeout';

const VOICE_URL = 'https://api.meta.ai/v1/asr/transcribe';
const VOICE_MODEL = 'muse-voice-transcribe-1.0';

export interface Transcript {
  text: string;
  turns: TranscriptTurn[];
}

interface VoiceResponse {
  transcript?: string;
  audioDurationMs?: number;
  turns?: Array<{ startMs?: number; endMs?: number; transcript?: string }>;
}

function requireKey(): string {
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new Error('MODEL_API_KEY is not set');
  return key;
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
  const t = startTimeout();
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
  return { transcript: { text, turns }, costUsd: (ms / 3_600_000) * PRICING.voiceTranscribePerHourUsd };
}
