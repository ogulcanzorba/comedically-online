# Comedically Online

Live stand-up streaming with comedy-aware moderation. Hackathon build (Phase 2: platform).

**Live comedy. Moderated by someone who gets the joke.**

> Legal pages (`/terms`, `/privacy`, `/cookies`, `/community-guidelines`,
> `/moderation-policy`) are **template drafts**. They must be reviewed by a lawyer
> before launch. Nothing here claims legal compliance.

## Run

```bash
npm install
cp .env.example .env   # set SESSION_SECRET; MODEL_API_KEY only for live AI modes
npm run seed           # 12 fictional comedians/shows + 2 viewers (SQLite file)
npm run seed:tags      # backfill auto tags (mock rules by default)
npm run dev            # http://localhost:3000
```

## Env vars

| Var | Default | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | dev-only fallback (warns) | HMAC for session cookies. Required in production. |
| `SQLITE_FILE` | `data/comedically.db` | Local SQLite file (gitignored, WAL mode). |
| `MODERATION_MODE` | `mock` | `mock` = scripted demo decisions; `live` = Meta models. |
| `TAG_MODE` | `mock` | `mock` = keyword tags; `live` = muse-spark-1.3 tags. |
| `MODEL_API_KEY` | — | Meta Model API key (baseURL `https://api.meta.ai/v1`). Never logged. |
| `MAX_SPEND_USD` | `5` | Hard moderation spend cap per stream; over it falls back to mock. |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Canonical/OG/sitemap base URL. |
| `PORT` / `PLAYBACK_DELAY_MS` | `3000` / `12000` | Server port / broadcast delay. |
| `MAX_HOLD_MS` | `4000` | Past delay + hold, unmoderated chunks release censored. |
| `VOICE_TIMEOUT_MS` / `SAM_TIMEOUT_MS` / `SPARK_TIMEOUT_MS` | `8000` / `20000` / `8000` | Per-model call timeouts. |
| `SAM_IMAGE_TIMEOUT_MS` | `6000` | SAM image calls: no retries, fail closed fast. |
| `VISION_BACKEND` | `spark` | Live visual path: `spark` (one multi-frame call) / `sam` / `gate`. Legacy `VISUAL_STRATEGY` alias honored when unset. |
| `SPARK_VISION_MODEL` / `SPARK_VISION_EFFORT` | `muse-spark-1.3` / `minimal` | Classifier model + effort (unsure band retries at `low`). |
| `VISION_HIT` / `VISION_UNSURE` | `0.5` / `0.3` | Blur at ≥HIT; [UNSURE, HIT) gets a 2nd opinion call. Hysteresis blurs 2 chunks past each hit. |
| `SPARK_PRICING_MODE` | `standard` | `contributor` bills Spark at $0.10/$0.20 per 1M tokens. |
| `GATE_FRAMES` / `GATE_TIMEOUT_MS` | `2` / `8000` | VLM calls per chunk over middle frames; per-call timeout. |
| `MOD_POOL` | `8` | Chunks moderating at once. |
| `VISUAL_FAIL_MODE` | `closed` | `open` releases failed visuals unblurred with a warning (demo testing). |
| `FRAMES_PER_CHUNK` / `NEXT_PUBLIC_FRAMES_PER_CHUNK` | `4` / `4` | Frames sampled per chunk (must match); linear image cost, flat wall time. |
| `FRAME_WIDTH` / `NEXT_PUBLIC_FRAME_WIDTH` | `640` / `640` | Sampled-frame width in px (must match; restart dev to apply). |
| `BLUR_PAD_CHUNKS` | `1` | Neighbor chunks blurred around a flagged chunk (`0` disables). |
| `DEBUG_FRAMES` | off | `1` saves sampled JPEGs to `debug-frames/` (gitignored) with per-concept `[sam]` logs. |
| `DEBUG_CAPTURE` / `CHUNKS_DIR` | off / `/tmp/chunks` | `1` saves moderation inputs for `npm run soak:live` replay. |

## Seed accounts (password for all: `Comedy123!`)

- Comedians: `ada@example.com`, `milo@example.com`, `kerem@example.com`, `rosa@example.com`,
  `benny@example.com`, `ingrid@example.com`, `tomas@example.com`, `ren@example.com`,
  `priya@example.com`, `gus@example.com`, `lena@example.com`, `diego@example.com`
- Viewers: `riley@example.com`, `sam@example.com` (both hold the 2 sellout tickets for “60 Jokes”)
- Demo Night (`/shows/demo-night`) is live immediately with a free $0 mock pass — log in,
  claim, watch.

## Features

- **Accounts**: viewer/comedian roles, bcrypt passwords, signed httpOnly sessions, login
  rate limit, same-origin CSRF guard, 18+ confirmation, server-side validation.
- **Shows**: public grid with category filter + search, SVG/gradient thumbnails, Live/Sold-out
  badges; show pages with countdown, viewer-local start time, comedian profile, tiers, tags.
- **Watch**: at start time the page becomes the player (12s broadcast delay, bleep/blur
  overlay, never cuts). Requires login + ticket; `/watch` redirects to Demo Night.
- **Studio** (comedian-only): overview dashboard with tool cards, `/studio/shows` show
  manager (local time + IANA zone → UTC, tier editor with caps + pay-what-you-want,
  revenue calculator with stated assumptions), per-show pre-live pages (rulebook
  acceptance, self-view with violation toasts + timeline and device-local recording
  (violation clips with censored playback/download + original toggle, full download,
  never uploaded; history wipes on each new broadcast), live moderation log,
  censored-moments recap, and in-place broadcast with LIVE badge + elapsed timer
  (gated on rulebook acceptance). `/studio/go-live` redirects to `/studio` (or the
  show's prepare page).
- **Rulebook** (`src/moderation/rulebook.json`, v1.0.0): the data behind mock moderation —
  1 audio bleep rule (“waffle”) + 2 video blur rules (three-finger gesture, nose touch).
  Every decision records its rule id + user-facing explanation; comedians must accept the
  current revision before broadcasting, and re-accept when it changes.
- **Checkout**: mock only (MOCK label everywhere). Card fields never leave the browser; only
  a fake order record is stored.
- **Discovery**: 12 category pages with icons, mock/live auto-tagging (`TAG_MODE`), tag
  chips, `/search?q=`.
- **Brand/SEO**: ink/spotlight/coral system (`BRAND.md`), self-hosted fonts, SVG logo +
  favicon, generated OG image, per-page metadata + canonicals, sitemap/robots, JSON-LD
  (Organization, WebSite, ComedyEvent), skip link + focus styles.
- **Legal/safety**: terms, privacy, cookies, community guidelines, moderation policy (what
  the AI does/does not do + human appeals), contact, essential-cookies-only banner, footer.

## How streaming + moderation work (unchanged from Phase 1)

2s WebM chunks + parallel 16kHz WAV over one WebSocket; server ring buffer releases
chunk + decisions exactly 12s after server receipt. Ending is graceful: the server
drains the buffer to viewers before end-of-stream, with drain progress to the
studio. Mock mode scripts bleeps/blurs; live mode behind the spend cap:
- **Video**: one Spark Responses call per chunk over the previous chunk's last
  2 frames + this chunk's 4 (rulebook-generated prompt, JSON verdicts with
  per-rule confidence; unsure band gets a `low` 2nd opinion; hysteresis blurs
  2 chunks past each hit). `sam`/`gate` backends stay via `VISION_BACKEND`.
- **Audio**: realtime ASR over WebSocket (Turkish-aware fuzzy match on every
  partial/final, `[t-1500ms, t+300ms]` bleeps; fuzzy-only goes to the judge
  with fail-closed timing) plus 4s overlapping file-transcription fallback
  (whole-chunk bleeps, skipped where realtime covers). Studio shows a banner
  while realtime is down.
Measured (eval script, synthetic clean clips): spark-minimal-640 ~2.4s wall at
~$5/stream-hour; spark-minimal-320 ~$2.8/h; sam ~$36/h.

## Checks

```bash
npm run typecheck   # strict TS, must be clean
npm test            # full suite incl. vision/fuzzy/realtime protocol tests
npm run prove:relay # end-to-end relay proof with the real 12s delay (~17s)
npm run build       # production build incl. middleware + sitemap
npm run smoke       # one cheap live call per Meta model (needs MODEL_API_KEY)
npm run eval:gestures -- <clips-dir>  # backend accuracy/latency/cost table ($1 cap)
```

## Known limits

- Single concurrent relay stream shared by all “live” show pages; tickets gate access, not
  the transport. Multi-show isolation is future work.
- SQLite file is local (no replication); in-memory rate limits reset on restart.
- Spark vision calls must fit in MAX_HOLD_MS (default 4s); `low` effort at
  640px can exceed it and fail closed — raise the hold or stay on `minimal`.
- Recall numbers need real labelled gesture clips; only clean-path eval ran here.
- Live visual + audio paths are verified with a key (spark verdicts, realtime
  transcripts, waffle bleep on real speech, Turkish transcription). Mock
  stays the default.
- No real payments, email, or recording storage — all intentionally mocked or omitted.
