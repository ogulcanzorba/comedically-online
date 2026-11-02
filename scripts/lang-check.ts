/**
 * Language check: run a Turkish and an English 2s WAV (each saying "waffle"
 * in a sentence) through live transcription, print both transcripts, and
 * report whether the "waffle" rule matched each one.
 *
 * The fixtures are NOT committed (no mic or TTS in CI): record two clips,
 * 16kHz mono WAV, ~2s each, and pass their paths:
 *
 *   Turkish: "Sahnede waffle hakkında komik bir hikaye anlattım."
 *   English: "I told a funny story about waffle on stage."
 *
 * Usage:
 *   MODEL_API_KEY=... MODERATION_MODE=live npm run lang-check -- \
 *     --tr /path/to/tr.wav --en /path/to/en.wav
 *
 * Defaults: scripts/fixtures/lang-tr.wav and scripts/fixtures/lang-en.wav.
 * Cost is ~2x2s of Voice Transcribe (about $0.0002). The key is only sent
 * in the Authorization header and is never printed or logged.
 */
import { existsSync, readFileSync } from 'node:fs';
import { transcribeChunk } from '../src/moderation/transcribe';
import { audioRulesMatching } from '../src/moderation/rulebook';

function argValue(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : fallback;
}

/** Minimal RIFF parse for the report: sample rate, channels, duration. */
function wavInfo(buf: Buffer): string {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return 'not a WAV file';
  const channels = buf.readUInt16LE(22);
  const rate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  const dataBytes = buf.readUInt32LE(40);
  const seconds = rate > 0 && channels > 0 ? dataBytes / ((rate * channels * bits) / 8) : 0;
  return `${rate}Hz ${channels === 1 ? 'mono' : `${channels}ch`} ${bits}-bit ${seconds.toFixed(2)}s`;
}

async function check(label: string, path: string): Promise<boolean> {
  if (!existsSync(path)) {
    console.error(
      `Missing ${label} sample: ${path}\n` +
        'Record a ~2s 16kHz mono WAV saying the sentence from the header comment,\n' +
        'then re-run with --tr <path> --en <path>.',
    );
    return false;
  }
  const wav = readFileSync(path);
  console.log(`--- ${label}: ${path} (${wavInfo(wav)})`);
  if (process.env.MODERATION_MODE !== 'live') {
    console.error('Set MODERATION_MODE=live to run the real transcription check.');
    return false;
  }
  const { transcript, costUsd } = await transcribeChunk(wav, 0, 'live');
  console.log(`transcript: ${JSON.stringify(transcript.text)}`);
  console.log(`turns: ${JSON.stringify(transcript.turns)}`);
  const matched = audioRulesMatching(transcript.text);
  if (matched.length > 0) {
    console.log(`RULE MATCH: ${matched.map((m) => `${m.rule.id} (via "${m.variant}")`).join(', ')}`);
  } else {
    console.log('RULE MATCH: none — the "waffle" rule did NOT match this clip');
  }
  console.log(`cost: $${costUsd.toFixed(6)}`);
  return matched.length > 0;
}

async function main(): Promise<void> {
  const trPath = argValue('--tr', 'scripts/fixtures/lang-tr.wav');
  const enPath = argValue('--en', 'scripts/fixtures/lang-en.wav');
  async function tryCheck(label: string, path: string): Promise<boolean> {
    try {
      return await check(label, path);
    } catch (e) {
      console.error(`${label} transcription failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }
  const trOk = await tryCheck('Turkish', trPath);
  const enOk = await tryCheck('English', enPath);
  console.log(
    trOk && enOk
      ? 'LANG-CHECK: both clips matched the waffle rule'
      : 'LANG-CHECK: at least one clip did NOT match (see above)',
  );
  process.exit(trOk && enOk ? 0 : 1);
}

void main();
