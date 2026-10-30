/**
 * One cheap real call to each Meta model (well under $0.05 total).
 * Prints response shapes so the live adapters match the wire format.
 * Requires MODEL_API_KEY. The key is only sent in the Authorization
 * header and is never printed or logged.
 */
import { deflateSync } from 'node:zlib';
import OpenAI from 'openai';

const BASE_URL = 'https://api.meta.ai/v1';

function apiKey(): string {
  const key = process.env.MODEL_API_KEY;
  if (!key) {
    console.error('MODEL_API_KEY is not set. Copy .env.example to .env and set it.');
    process.exit(2);
  }
  return key;
}

/** 1s 16kHz mono WAV: 440Hz tone for 0.5s, then silence. */
function synthWav(): Buffer {
  const rate = 16_000;
  const samples = new Int16Array(rate);
  for (let i = 0; i < rate / 2; i++) {
    samples[i] = Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate));
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + samples.byteLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(samples.byteLength, 40);
  return Buffer.concat([header, Buffer.from(samples.buffer)]);
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** 8x8 solid red PNG, built without dependencies. */
function redPngDataUrl(): string {
  const w = 8;
  const h = 8;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0; // filter 0
    for (let x = 0; x < w; x++) {
      raw[y * (1 + w * 3) + 1 + x * 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function smokeVoice(key: string): Promise<void> {
  console.log('--- VOICE (muse-voice-transcribe-1.0, 1s WAV, ENDPOINTING) ---');
  const form = new FormData();
  form.append(
    'request',
    new Blob(
      [JSON.stringify({ model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', mode: 'ENDPOINTING' })],
      { type: 'application/json' },
    ),
  );
  const wavBytes = Uint8Array.from(synthWav());
  form.append('audio', new Blob([wavBytes], { type: 'audio/wav' }), 'smoke.wav');
  const res = await fetch(`${BASE_URL}/asr/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    body: form,
  });
  const body = (await res.json()) as unknown;
  console.log('status:', res.status);
  console.log('shape:', JSON.stringify(body).slice(0, 1500));
}

async function smokeSam(key: string): Promise<void> {
  console.log('--- SAM (sam-3.1, 8x8 red PNG, prompt "red square") ---');
  const client = new OpenAI({ baseURL: BASE_URL, apiKey: key });
  const stream = client.responses.stream({
    model: 'sam-3.1',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'red square' },
          { type: 'input_image', image_url: redPngDataUrl() },
        ],
      },
    ],
  } as unknown as Parameters<typeof client.responses.stream>[0]);
  let text = '';
  const eventTypes = new Set<string>();
  for await (const event of stream) {
    const ev = event as { type?: string; delta?: string };
    if (ev.type) eventTypes.add(ev.type);
    if (ev.type === 'response.output_text.delta' && typeof ev.delta === 'string') text += ev.delta;
  }
  console.log('event types:', [...eventTypes].join(', '));
  console.log('output_text:', text.slice(0, 800) || '(empty lane: zero matches)');
}

async function smokeSpark(key: string): Promise<void> {
  console.log('--- SPARK (muse-spark-1.3, tiny judge call) ---');
  const client = new OpenAI({ baseURL: BASE_URL, apiKey: key });
  const res = await client.chat.completions.create({
    model: 'muse-spark-1.3',
    messages: [
      {
        role: 'user',
        content: 'Reply with exactly this JSON and nothing else: {"action":"allow","reason":"smoke"}',
      },
    ],
    max_tokens: 60,
  });
  console.log('content:', res.choices[0]?.message?.content);
  console.log('usage:', JSON.stringify(res.usage ?? null));
}

async function main(): Promise<void> {
  const key = apiKey();
  await smokeVoice(key);
  await smokeSam(key);
  await smokeSpark(key);
  console.log('SMOKE DONE. Estimated total: <$0.01 (1s audio + 1 tiny image + ~100 tokens).');
}

void main();
