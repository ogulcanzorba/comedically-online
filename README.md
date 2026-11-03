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
| `MOD_POOL` | `8` | Chunks moderating at once. |
| `VISUAL_FAIL_MODE` | `closed` | `open` releases failed visuals unblurred with a warning (demo testing). |
| `SAM_FRAMES_PER_CHUNK` | `1` | `2` samples t≈0.5s/1.5s for briefer gestures (2x image cost, same wall time). |
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
chunk + decisions exactly 12s after server receipt. Mock mode scripts bleeps/blurs;
live mode uses Voice Transcribe + SAM 3.1 (one 320px middle-frame image call per
video rule, plus a 320px video confirm call on positive chunks only) + the Spark
judge behind the spend cap. SAM video bills a 50-frame minimum per call, images
$0.0025 each; clean traffic runs ~$9/stream-hour.

## Checks

```bash
npm run typecheck   # strict TS, must be clean
npm test            # 8 suites (auth, delay, moderation, overlay, datetime, timezone, pricing, tags)
npm run prove:relay # end-to-end relay proof with the real 12s delay (~17s)
npm run build       # production build incl. middleware + sitemap
npm run smoke       # one cheap live call per Meta model (needs MODEL_API_KEY)
```

## Known limits

- Single concurrent relay stream shared by all “live” show pages; tickets gate access, not
  the transport. Multi-show isolation is future work.
- SQLite file is local (no replication); in-memory rate limits reset on restart.
- Bleep timing is turn-level (Voice returns turns, not words).
- Live SAM is verified with a key (frame sampling + confirm calls); WebM is
  transcoded to MP4/JPEG first since SAM rejects WebM. Mock stays the default.
- No real payments, email, or recording storage — all intentionally mocked or omitted.
