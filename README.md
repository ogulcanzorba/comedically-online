# Comedically Online

Live-streaming for stand-up comedians only. Hackathon MVP.

**Live comedy. Moderated by someone who gets the joke.**

## Run

```bash
npm install
cp .env.example .env   # set MODEL_API_KEY only for live moderation
npm run dev            # http://localhost:3000
```

Pages: `/` landing, `/studio` comedian, `/watch` viewer (locked until mock
checkout), `/checkout` mock tickets.

## How it works

- `/studio` records 2s WebM chunks (`MediaRecorder`, timeslice 2000, vp8+opus)
  plus a parallel 16kHz mono WAV for transcription, and sends both over one
  WebSocket (`/ws?role=publisher`).
- `server.ts` + `src/server/stream-host.ts` hold chunks in a ring buffer
  (`src/lib/delay-buffer.ts`) and release each chunk **plus its moderation
  decisions** to viewers exactly 10s after server receipt. First bytes carry
  the WebM init segment; late joiners get it immediately.
- `/watch` appends chunks in order via MediaSource, draws blur boxes over the
  video, and mutes during bleep windows. The stream is never cut: only the
  problem word or region is covered.
- `/checkout` sells a mock ticket ($5) or subscription ($12/mo). Card fields
  never leave the browser; success sets an unlock cookie for `/watch`.
  Labelled **MOCK PAYMENT, no money is charged** throughout.

## Moderation (`src/moderation/`)

Modes via `MODERATION_MODE=mock|live` (default `mock`).

- `transcribeChunk` — Muse Voice Transcribe (`muse-voice-transcribe-1.0`,
  `POST /asr/transcribe`, ENDPOINTING for turn-level times) in live mode;
  scripted bits in mock mode.
- `detectVisual` — SAM 3.1 (`sam-3.1`, Responses API, one concept per
  request) over the 2s clip in live mode — never per-frame; fixed demo box
  in mock mode.
- `judgeContext` — `muse-spark-1.3` comedy-aware judge (joke/satire vs real
  attack + the comedian's own house rules) in live mode; keyword stand-in
  logic in mock mode.
- Demo uses harmless stand-ins only: the invented word "blorpt", a fixed
  phone-screen box, clean bits.

## Costs

Priced in `src/moderation/cost.ts`: Voice $0.18/h, SAM video $0.20/1k
frames, Spark $1.25/$4.25 per M input/output tokens. Every chunk logs
`+$`/total/projected-$/h. `MAX_SPEND_USD` (default 5) is a hard cap: past
it the pipeline falls back to mock automatically. Note: at full live
fidelity SAM dominates (~60 frames per 2s chunk), so expect the cap to trip
within a long set — that fallback is part of the demo.

Live smoke test (one cheap call per model, <$0.05 total):

```bash
MODEL_API_KEY=... npm run smoke
```

The key is read from the environment only and is never logged.

## Checks

```bash
npm run typecheck   # strict TS, must be clean
npm test            # delay buffer + mock moderation + overlay timing
npm run prove:relay # end-to-end relay proof with the real 10s delay (~15s)
npm run build       # production build incl. middleware gate
```

## Demo rehearsal (mock mode)

1. Terminal: `npm run dev`. Browser A: `/studio`, allow camera/mic.
2. Browser B: `/checkout`, pick Ticket, fill any fake card values, submit —
   lands on `/watch`, sees "Moderation active".
3. A clicks **Go live**. B's video starts ~10-12s later (10s delay + first
   2s chunk). A narrates the house rules shown in the rules box.
4. Scripted beats (chunk time → viewer sees +10s): ch2 bleep of "blorpt",
   ch3 phone-screen blur, ch6 bleep, ch8 blur… A reads the moderation log
   aloud as entries land; B sees the bleep pill and blur box in place while
   the show never stops.
5. A clicks **End stream**; B's player drains the delayed tail.

## Known limits (MVP)

- Single concurrent stream; state is in-memory (+ `data/mock-users.json`).
- Chrome recommended (WebM/VP8 + MediaSource + AudioWorklet).
- Bleep timing is turn-level (Voice returns turns, not words); the word's
  proportional slice of its turn is muted.
- Live SAM assumes the API accepts `video/webm` data URLs; unverified until
  `npm run smoke` runs with a key. Mock is the default for this reason.
- `tsx` runs the TS server/tests; plain `tsc`+`node` works too.
