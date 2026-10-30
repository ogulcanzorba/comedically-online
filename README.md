# Comedically Online

Live-streaming for stand-up comedians only. Hackathon MVP.

Tagline: **Live comedy. Moderated by someone who gets the joke.**

## Run

```bash
npm install
cp .env.example .env   # then set MODEL_API_KEY for live moderation
npm run dev            # http://localhost:3000
```

Pages: `/` landing, `/studio` comedian, `/watch` viewer, `/checkout` mock tickets.

## How it works (Day 1)

- Studio records 2s WebM chunks (`MediaRecorder`, timeslice 2000) and sends them over a
  WebSocket with server receipt timestamps.
- `server.ts` + `src/server/stream-host.ts` hold chunks in a ring buffer
  (`src/lib/delay-buffer.ts`) and release each chunk + its moderation decisions to
  viewers **exactly 10s after server receipt**.
- Viewers append chunks in order via MediaSource (first bytes carry the init segment).
- Moderation is a passthrough on Day 1; mock + live adapters land on Day 2.

## Checks

```bash
npm run typecheck   # strict TS
npm test            # delay-buffer unit tests
npm run prove:relay # end-to-end relay proof with the real 10s delay (~15s)
```

## Notes

- Single concurrent stream; state is in-memory + `data/mock-users.json`.
- Never commit `.env` or log `MODEL_API_KEY`. Mock mode is the default fallback.
- Demo uses harmless stand-ins only (invented banned word, middle finger, phone screen).
