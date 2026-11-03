import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadavg } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { WebSocket } from 'ws';
import { DelayBuffer } from '../lib/delay-buffer';
import { Semaphore } from '../lib/semaphore';
import { FALLBACK_LABEL, mergeBleepWindow, moderateChunk, moderationMode } from '../moderation/index';
import { audioBleepRules, ruleById } from '../moderation/rulebook';
import {
  computeBlurWindows,
  mergeFrameVerdicts,
  releaseCleanFrames,
  sliceWindowsToChunk,
  VISION_RANGE_MARGIN_MS,
} from '../moderation/spark-vision';
import type { BlurWindow, FrameVerdict } from '../moderation/spark-vision';
import { judgeContext } from '../moderation/judge';
import { isNearExact, matchBanned, OccurrenceTracker, tokenizeTr } from '../moderation/fuzzy';
import type { BannedSpelling, FuzzyHit } from '../moderation/fuzzy';
import {
  mapRangeToChunks,
  PCM16_BYTES_PER_MS,
  realtimeBleepWindow,
  RealtimeSession,
} from '../moderation/realtime';
import { concatWavs, extractWavPcm, wavPcmMs } from '../moderation/transcribe';
import { ffmpegActiveChildren, preassembleChunk } from '../moderation/transcode';
import { SpendTracker, maxSpendUsd, projectedHourlyUsd } from '../moderation/cost';
import type { ChunkDebug, Decision, ModerationLogEntry } from '../moderation/types';
import type {
  ChunkMetaMessage,
  ClientRole,
  DrainProgressMessage,
  EndBroadcastMessage,
  EndOfStreamMessage,
  LogBroadcast,
  MediaMetaMessage,
  RulesMessage,
  StartingMessage,
  StreamEndedMessage,
  StudioWarningMessage,
} from '../lib/ws-protocol';

export interface StreamHostOptions {
  delayMs?: number;
  tickMs?: number;
  /** How long to wait for a chunk's wav before moderating without it. */
  audioWaitMs?: number;
  /** Past delayMs + maxOverdueMs, an unmoderated chunk is released censored. */
  maxOverdueMs?: number;
  /** Max chunks moderating at once (bounded pool; release order stays by seq). */
  maxConcurrent?: number;
}

/** Max hold past the playback delay before a chunk is released censored. */
export const DEFAULT_MAX_OVERDUE_MS = 4_000;

/** Overridable via MAX_HOLD_MS (ms past the delay). */
export function maxHoldMs(): number {
  const raw = Number(process.env.MAX_HOLD_MS ?? DEFAULT_MAX_OVERDUE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_OVERDUE_MS;
}

/** Default moderation pool size. */
export const DEFAULT_MAX_CONCURRENT = 8;

/** Overridable via MOD_POOL (chunks moderating at once). Quota allows 8+. */
export function maxConcurrent(): number {
  const raw = Number(process.env.MOD_POOL ?? DEFAULT_MAX_CONCURRENT);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_CONCURRENT;
}

/**
 * Default safety-margin blur span around a flagged chunk (±chunks).
 * Frame-localized ranges made the backward margin redundant (it blurred
 * whole chunks before the gesture); raise via BLUR_PAD_CHUNKS for SAM.
 */
export const DEFAULT_BLUR_PAD_CHUNKS = 0;

/** Overridable via BLUR_PAD_CHUNKS (0 disables the safety margin). */
export function blurPadChunks(): number {
  const raw = Number(process.env.BLUR_PAD_CHUNKS ?? DEFAULT_BLUR_PAD_CHUNKS);
  return Number.isInteger(raw) && raw >= 0 ? raw : DEFAULT_BLUR_PAD_CHUNKS;
}

/** Label marking safety-margin decisions (also the dedupe key with ruleId). */
const PAD_LABEL = 'safety margin';

/** Labels on realtime scheduled bleeps (exact vs fuzzy-judged). */
const REALTIME_LABEL = 'realtime';
const REALTIME_FUZZY_LABEL = 'realtime-fuzzy';

/** Studio warning code while realtime ASR is down (fallback covers audio). */
const REALTIME_DOWN_CODE = 'realtime-down';

/** PCM bytes per 2s chunk at 16kHz 16-bit mono (alignment unit). */
const CHUNK_PCM_BYTES = 2000 * PCM16_BYTES_PER_MS;

/** Pre-show viewer countdown once the comedian starts (default 10s). */
export function startCountdownMs(): number {
  const raw = Number(process.env.START_COUNTDOWN_MS ?? 10_000);
  return Number.isFinite(raw) && raw >= 0 ? raw : 10_000;
}

/**
 * Full-chunk fail-closed decisions: a moderation error censors instead of
 * releasing raw unmoderated media to viewers.
 */
export function failClosedDecisions(reason: string): Decision[] {
  return [
    { action: 'bleep', reason, startMs: 0, endMs: 2000 },
    {
      action: 'blur',
      reason,
      startMs: 0,
      endMs: 2000,
      box: { ...FULL_FRAME },
      label: 'full frame (moderation error)',
    },
  ];
}

/**
 * Minimum float (ms) between a fuzzy hit and the audio leaving the delay
 * buffer for the judge to be worth consulting. Below this the bleep applies
 * at once (fail-closed): a verdict that cannot arrive in time helps nobody.
 */
const FUZZY_JUDGE_BUDGET_MS = 6000;

/**
 * Same-rule realtime hits within this stream-ms distance are one occurrence
 * (exact + fuzzy + judge must not triple-bleep a word). Tokens differ across
 * normalizations, so the identity is rule + time, not the token text.
 */
const RT_OCCURRENCE_MS = 1000;

/** Frame-verdict history kept per vision rule (covers long held gestures). */
const VISION_HISTORY_MS = 60_000;

const FULL_FRAME = { x: 0, y: 0, w: 1, h: 1 } as const;

function padBlurDecision(ruleId: string, fromSeq: number): Decision {
  const rule = ruleById(ruleId);
  return {
    action: 'blur',
    reason: rule
      ? `rule ${rule.id}: safety margin for ${rule.title} (flagged at chunk #${fromSeq})`
      : 'safety margin blur',
    startMs: 0,
    endMs: 2000,
    box: { ...FULL_FRAME },
    label: PAD_LABEL,
    ruleId,
    ...(rule ? { explanation: rule.explanation } : {}),
  };
}

function trackedBlurDecision(ruleId: string, startMs: number, endMs: number): Decision {
  const rule = ruleById(ruleId);
  return {
    action: 'blur',
    reason: rule
      ? `rule ${rule.id}: ${rule.title} tracked (${startMs}–${endMs}ms)`
      : `tracked gesture (${startMs}–${endMs}ms)`,
    startMs,
    endMs,
    box: { ...FULL_FRAME },
    label: 'tracked blur',
    ruleId,
    ...(rule ? { explanation: rule.explanation } : {}),
  };
}

function realtimeBleepDecision(
  ruleId: string,
  token: string,
  startMs: number,
  endMs: number,
  fuzzy: boolean,
): Decision {
  const rule = ruleById(ruleId);
  return {
    action: 'bleep',
    reason: rule
      ? `rule ${rule.id}: realtime ${fuzzy ? 'fuzzy ' : ''}match "${token}"`
      : `realtime ${fuzzy ? 'fuzzy ' : ''}match`,
    startMs,
    endMs,
    label: fuzzy ? REALTIME_FUZZY_LABEL : REALTIME_LABEL,
    ruleId,
    ...(rule ? { explanation: rule.explanation } : {}),
  };
}

function fallbackBleepDecision(ruleId: string): Decision {
  const rule = ruleById(ruleId);
  return {
    action: 'bleep',
    reason: rule
      ? `rule ${rule.id}: fallback window hit (fallback window)`
      : 'fallback window hit (fallback window)',
    startMs: 0,
    endMs: 2000,
    label: FALLBACK_LABEL,
    ruleId,
    ...(rule ? { explanation: rule.explanation } : {}),
  };
}

/** Banned spellings (match + aliases) for realtime keywords and fuzzy matching. */
function bannedSpellings(): BannedSpelling[] {
  const out: BannedSpelling[] = [];
  for (const r of audioBleepRules()) {
    out.push({ ruleId: r.id, spelling: r.match });
    for (const a of r.aliases ?? []) out.push({ ruleId: r.id, spelling: a });
  }
  return out;
}

/**
 * Chunk capture dir for DEBUG_CAPTURE=1 (replayed by `npm run soak:live`).
 * CHUNKS_DIR overrides the default /tmp/chunks (tests use a temp dir).
 */
export function captureDir(): string | null {
  if (process.env.DEBUG_CAPTURE !== '1') return null;
  return process.env.CHUNKS_DIR ?? '/tmp/chunks';
}

/** How often the [stats] load line prints. */
const STATS_INTERVAL_MS = 5_000;

interface PendingMedia {
  webm: { data: Buffer; receiptTimeMs: number } | null;
  wav: Buffer | null;
  jpg: Buffer[];
  serverSeq: number | null;
  studioSeq: number;
  timer: NodeJS.Timeout | null;
  started: boolean;
}

/**
 * Single-stream relay: buffers publisher chunks, moderates each one, and
 * releases chunk + decisions to viewers `delayMs` after server receipt.
 * The first chunk's bytes are retained as the init segment for late joiners.
 */
export class StreamHost {
  private buffer: DelayBuffer<Buffer>;
  private readonly decisions = new Map<number, Decision[]>();
  private readonly chunkDebug = new Map<number, ChunkDebug>();
  private readonly pendingModeration = new Set<number>();
  private readonly viewers = new Set<WebSocket>();
  private readonly startedViewers = new Set<WebSocket>();
  private publisher: WebSocket | null = null;
  /** End requested: drain the buffer, then notify publisher + viewers. */
  private ending = false;
  private endAnnounced = false;
  private readonly endedViewers = new Set<WebSocket>();
  private lastDrainSent = -1;
  /** Safety-margin blurs owed to chunks not yet stored (seq -> pads). */
  private readonly padOwed = new Map<number, Array<{ ruleId: string; fromSeq: number }>>();
  private readonly forceReleased = new Set<number>();
  /** Studio seqs whose moderation already started (labels late/orphaned wavs). */
  private readonly startedStudio = new Set<number>();
  private readonly log: ModerationLogEntry[] = [];
  /** Previous chunk's canvas frames (Spark vision overlap input). */
  private lastJpgs: Buffer[] = [];
  /** Per-rule frame verdict history for the gesture tracker (reset per broadcast). */
  private visionFrameHistory = new Map<string, FrameVerdict[]>();
  /** Previous chunk's wav (4s overlapping fallback window). */
  private lastWav: Buffer | null = null;
  private lastWavStudioSeq = -1;
  /** Realtime ASR session (live mode only; null in mock). */
  private realtime: RealtimeSession | null = null;
  private realtimeUp = false;
  private realtimeWarned = false;
  private rtTracker = new OccurrenceTracker();
  /** Scheduled realtime bleeps (rule + stream ms) for occurrence dedupe. */
  private rtScheduled: Array<{ ruleId: string; tMs: number }> = [];
  /** Seqs carrying a realtime bleep (fallback skips covered chunks). */
  private readonly realtimeBleepedSeqs = new Set<number>();
  /** Realtime bleeps owed to chunks not yet stored (seq -> bleeps). */
  private readonly bleepOwed = new Map<number, Decision[]>();
  private readonly fuzzyTimers = new Set<NodeJS.Timeout>();
  private readonly transcriptWindow: Array<{ atMs: number; text: string }> = [];
  private readonly tracker = new SpendTracker();
  private readonly streamStartMs = Date.now();
  private initSegment: Buffer | null = null;
  /** Publisher attach time (Date.now(), 0 before the first broadcast). */
  private broadcastStartedAtMs = 0;
  /** Viewers waiting for chunk-0 decisions before their init bytes. */
  private readonly pendingInit = new Set<WebSocket>();
  private nextSeq = 0;
  private pendingMeta: MediaMetaMessage | null = null;
  private readonly pendingMedia = new Map<number, PendingMedia>();
  private readonly audioWaitMs: number;
  private readonly maxOverdueMs: number;
  private readonly pool: Semaphore;
  private readonly poolMax: number;
  private readonly timer: NodeJS.Timeout;
  private readonly statsTimer: NodeJS.Timeout;
  private readonly loopDelay = monitorEventLoopDelay({ resolution: 20 });
  private lastCpu = process.cpuUsage();

  constructor(opts: StreamHostOptions = {}) {
    this.buffer = new DelayBuffer<Buffer>(opts.delayMs);
    this.audioWaitMs = opts.audioWaitMs ?? 750;
    this.maxOverdueMs = opts.maxOverdueMs ?? maxHoldMs();
    this.poolMax = opts.maxConcurrent ?? maxConcurrent();
    this.pool = new Semaphore(this.poolMax);
    this.timer = setInterval(() => {
      this.flush();
    }, opts.tickMs ?? 250);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.loopDelay.enable();
    if (typeof (this.loopDelay as unknown as { unref?: () => void }).unref === 'function') {
      (this.loopDelay as unknown as { unref: () => void }).unref();
    }
    this.statsTimer = setInterval(() => this.logStats(), STATS_INTERVAL_MS);
    if (typeof this.statsTimer.unref === 'function') this.statsTimer.unref();
  }

  get delayMs(): number {
    return this.buffer.delay;
  }

  get spendUsd(): number {
    return this.tracker.totalUsd;
  }

  handleConnection(ws: WebSocket, role: ClientRole): void {
    if (role === 'publisher') {
      this.attachPublisher(ws);
      return;
    }
    if (this.streamOver) {
      // Joined after the end: nothing to serve, say so immediately.
      this.sendJson(ws, { type: 'end' } satisfies EndOfStreamMessage);
      return;
    }
    this.viewers.add(ws);
    const countdown = startCountdownMs();
    const elapsed = Date.now() - this.broadcastStartedAtMs;
    if (this.broadcastStartedAtMs > 0 && elapsed < countdown) {
      this.sendJson(ws, {
        type: 'starting',
        startsInMs: Math.max(0, countdown - elapsed),
      } satisfies StartingMessage);
    }
    if (this.initSegment) {
      if (this.decisions.has(0)) {
        this.sendInit(ws);
      } else {
        // Chunk 0 still moderating: hold init bytes until its decisions
        // exist, so joiners never play unmoderated media.
        this.pendingInit.add(ws);
      }
      this.startedViewers.add(ws);
    }
    ws.on('close', () => {
      this.viewers.delete(ws);
      this.startedViewers.delete(ws);
      this.pendingInit.delete(ws);
    });
  }

  /** Init bytes for a late joiner, always paired with chunk-0 decisions. */
  private sendInit(ws: WebSocket): void {
    if (!this.initSegment) return;
    this.pendingInit.delete(ws);
    this.sendChunk(ws, {
      seq: 0,
      data: this.initSegment,
      init: true,
      decisions: this.decisions.get(0) ?? [],
    });
  }

  /** Release held init bytes once chunk 0 is moderated (or force-released). */
  private flushPendingInit(seq: number): void {
    if (seq !== 0 || this.pendingInit.size === 0) return;
    for (const ws of [...this.pendingInit]) {
      if (ws.readyState !== 1) {
        this.pendingInit.delete(ws);
        continue;
      }
      this.sendInit(ws);
    }
  }

  close(): void {
    clearInterval(this.timer);
    clearInterval(this.statsTimer);
    this.loopDelay.disable();
    for (const pending of this.pendingMedia.values()) {
      if (pending.timer) clearTimeout(pending.timer);
    }
    this.pendingMedia.clear();
    this.viewers.clear();
    this.startedViewers.clear();
    this.publisher = null;
    this.stopRealtime();
  }

  private attachPublisher(ws: WebSocket): void {
    if (this.publisher && this.publisher !== ws) {
      try {
        this.publisher.close(1000, 'replaced by new publisher');
      } catch {
        // ignore close errors on a stale socket
      }
    }
    this.publisher = ws;
    this.resetStream();
    this.startRealtime();
    this.broadcastStartedAtMs = Date.now();
    for (const viewer of [...this.viewers]) {
      this.sendJson(viewer, {
        type: 'starting',
        startsInMs: startCountdownMs(),
      } satisfies StartingMessage);
    }
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        this.onBinary(Buffer.from(data as Buffer));
        return;
      }
      this.onPublisherText(data.toString());
    });
    ws.on('close', () => {
      // Crash or tab close without end-broadcast: viewers still get the
      // drain plus end-of-stream; only the publisher progress is lost.
      if (this.publisher === ws) {
        this.publisher = null;
        this.requestEnd();
      }
    });
  }

  /** True once end was requested and every chunk has played out. */
  private get streamOver(): boolean {
    return this.ending && this.buffer.size === 0 && this.pendingModeration.size === 0;
  }

  private sendJson(ws: WebSocket, msg: object): void {
    if (ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // dropping a notification must never break the relay
    }
  }

  private resetStream(): void {
    this.ending = false;
    this.endAnnounced = false;
    this.endedViewers.clear();
    this.lastDrainSent = -1;
    this.padOwed.clear();
    this.buffer.clear();
    this.decisions.clear();
    this.chunkDebug.clear();
    this.pendingModeration.clear();
    this.forceReleased.clear();
    this.startedStudio.clear();
    this.pendingMedia.clear();
    this.pendingMeta = null;
    this.initSegment = null;
    this.broadcastStartedAtMs = 0;
    this.pendingInit.clear();
    this.nextSeq = 0;
    this.lastJpgs = [];
    this.visionFrameHistory.clear();
    this.lastWav = null;
    this.lastWavStudioSeq = -1;
    this.rtTracker = new OccurrenceTracker();
    this.rtScheduled = [];
    this.realtimeBleepedSeqs.clear();
    this.bleepOwed.clear();
    for (const t of this.fuzzyTimers) clearTimeout(t);
    this.fuzzyTimers.clear();
    this.startedViewers.clear();
  }

  /** Start the realtime ASR session (live mode only; mock stays scripted). */
  private startRealtime(): void {
    this.stopRealtime();
    if (moderationMode() !== 'live') return;
    const key = process.env.MODEL_API_KEY;
    if (!key) {
      console.log('[realtime] MODEL_API_KEY missing; fallback covers audio');
      return;
    }
    const spellings = bannedSpellings();
    const keywords = [...new Set(spellings.map((s) => s.spelling))];
    const session = new RealtimeSession(
      key,
      { keywords, languageBias: ['Turkish', 'English'] },
      {
        onTranscript: (ev) => this.onRealtimeTranscript(ev),
        onStateChange: (up) => {
          this.realtimeUp = up;
          if (!up) {
            console.log('[realtime] socket down; fallback covers audio');
            this.warnStudio(true);
          } else {
            console.log('[realtime] socket up');
            this.warnStudio(false);
          }
        },
        onError: (detail) => console.log(`[realtime] ${detail}`),
      },
    );
    this.realtime = session;
    session.connect();
  }

  private stopRealtime(): void {
    try {
      this.realtime?.close();
    } catch {
      // teardown never throws
    }
    this.realtime = null;
    this.realtimeUp = false;
    this.realtimeWarned = false;
  }

  /** Studio health banner for realtime ASR (transitions only). */
  private warnStudio(active: boolean): void {
    if (active === this.realtimeWarned) return;
    this.realtimeWarned = active;
    if (!this.publisher) return;
    this.sendJson(this.publisher, {
      type: 'warning',
      code: REALTIME_DOWN_CODE,
      active,
      message: active
        ? 'Realtime transcription is down; audio uses whole-chunk fallback bleeps.'
        : 'Realtime transcription recovered.',
    } satisfies StudioWarningMessage);
  }

  /** End requested: keep serving viewers until the buffer fully plays out. */
  private requestEnd(): void {
    if (this.ending) return;
    this.ending = true;
    this.realtime?.endInput();
    console.log('[end] broadcast end requested; draining delay buffer for viewers…');
  }

  private onPublisherText(text: string): void {
    let msg: RulesMessage | MediaMetaMessage | EndBroadcastMessage | null = null;
    try {
      msg = JSON.parse(text) as RulesMessage | MediaMetaMessage | EndBroadcastMessage;
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'end-broadcast') {
      this.requestEnd();
      return;
    }
    if (msg.type === 'rules') {
      // Legacy clients may still send free-text rules; they are ignored.
      // Moderation follows only the platform rulebook. No log entry: an
      // ignored message must not look like an applied rule change.
      return;
    }
    if (msg.type === 'media') {
      const meta = msg as MediaMetaMessage;
      if (
        (meta.kind === 'webm' || meta.kind === 'wav' || meta.kind === 'jpg') &&
        Number.isInteger(meta.seq)
      ) {
        this.pendingMeta = meta;
      }
    }
  }

  /** Binary with no preceding media header is treated as a webm chunk (back-compat). */
  private onBinary(data: Buffer): void {
    const meta = this.pendingMeta;
    this.pendingMeta = null;
    const kind = meta?.kind ?? 'webm';
    const studioSeq = meta?.seq ?? this.nextSeq;
    let pending = this.pendingMedia.get(studioSeq);
    if (!pending) {
      pending = {
        webm: null,
        wav: null,
        jpg: [],
        serverSeq: null,
        studioSeq,
        timer: null,
        started: false,
      };
      this.pendingMedia.set(studioSeq, pending);
    }
    if (kind === 'wav') {
      pending.wav = data;
      this.feedRealtime(data, studioSeq);
      const state = this.startedStudio.has(studioSeq)
        ? 'late-orphan'
        : pending.webm
          ? 'paired'
          : 'early';
      console.log(`[rx] wav studio=${studioSeq} (${state}, ${data.length}B)`);
    } else if (kind === 'jpg') {
      pending.jpg.push(data);
      const state = this.startedStudio.has(studioSeq)
        ? 'late-orphan'
        : pending.webm
          ? 'paired'
          : 'early';
      console.log(
        `[rx] jpg studio=${studioSeq} frame#${pending.jpg.length} (${state}, ${data.length}B)`,
      );
    } else {
      const serverSeq = this.nextSeq;
      this.nextSeq += 1;
      const receiptTimeMs = Date.now();
      if (serverSeq === 0) this.initSegment = Buffer.from(data);
      this.buffer.push(data, receiptTimeMs, serverSeq);
      pending.webm = { data, receiptTimeMs };
      pending.serverSeq = serverSeq;
      this.pendingModeration.add(serverSeq);
      console.log(
        `[rx] webm studio=${studioSeq} -> server=${serverSeq} (${data.length}B) ` +
          `at=${new Date(receiptTimeMs).toISOString()}`,
      );
      pending.timer = setTimeout(() => this.startModeration(studioSeq), this.audioWaitMs);
      if (typeof pending.timer.unref === 'function') pending.timer.unref();
    }
    if (pending.webm && pending.wav) {
      this.startModeration(studioSeq);
    }
  }

  /**
   * Feed one chunk's PCM to realtime ASR, normalized to exactly 2s so the
   * audioProcessedMs mapping stays aligned even when a capture runs short.
   */
  private feedRealtime(wav: Buffer, studioSeq: number): void {
    if (!this.realtime) return;
    const parsed = extractWavPcm(wav);
    if (!parsed || parsed.sampleRate !== 16000 || parsed.channels !== 1 || parsed.bitsPerSample !== 16) {
      console.log(`[realtime] wav studio=${studioSeq} skipped (need 16kHz mono 16-bit)`);
      this.feedRealtimeSilence(studioSeq);
      return;
    }
    const pcm = parsed.pcm.length >= CHUNK_PCM_BYTES
      ? parsed.pcm.subarray(0, CHUNK_PCM_BYTES)
      : Buffer.concat([parsed.pcm, Buffer.alloc(CHUNK_PCM_BYTES - parsed.pcm.length)]);
    this.realtime.feedPcm(pcm, studioSeq * 2000);
  }

  /** Keep the realtime timeline aligned across a missing chunk's audio. */
  private feedRealtimeSilence(studioSeq: number): void {
    this.realtime?.feedPcm(Buffer.alloc(CHUNK_PCM_BYTES), studioSeq * 2000);
  }

  private startModeration(studioSeq: number): void {
    const pending = this.pendingMedia.get(studioSeq);
    if (!pending || pending.started || pending.serverSeq === null || !pending.webm) return;
    pending.started = true;
    if (pending.timer) clearTimeout(pending.timer);
    this.pendingMedia.delete(studioSeq);
    this.startedStudio.add(studioSeq);
    const seq = pending.serverSeq;
    // Detection input must be a standalone clip: later chunks are bare
    // clusters, so the retained init segment is prepended before transcoding.
    // Playback still uses the original WebM bytes from the delay buffer.
    const video = preassembleChunk(this.initSegment, pending.webm.data, seq === 0);
    const wav = pending.wav;
    const frameJpgs = pending.jpg;
    const prevFrameJpgs = this.lastJpgs;
    this.lastJpgs = frameJpgs;
    // 4s overlapping fallback window (prev + current chunk, 2s step). The
    // previous wav must be the adjacent chunk; otherwise the window holds
    // only this chunk. A missing wav feeds alignment silence to realtime.
    let windowWav: Buffer | null = wav;
    let wavPrevMs = 0;
    if (!wav) {
      this.feedRealtimeSilence(studioSeq);
    } else {
      if (this.lastWav && this.lastWavStudioSeq === studioSeq - 1) {
        const joined = concatWavs([this.lastWav, wav]);
        if (joined) {
          windowWav = joined;
          wavPrevMs = wavPcmMs(this.lastWav) ?? 0;
        }
      }
      this.lastWav = wav;
      this.lastWavStudioSeq = studioSeq;
    }
    const receiptTimeMs = pending.webm.receiptTimeMs;
    this.captureChunk(seq, video, wav, frameJpgs, receiptTimeMs);
    const recentTranscript = this.recentTranscript();
    // Bounded pool: at most poolMax chunks moderate at once, so a pileup
    // queues instead of stampeding the model APIs. Release order still
    // follows seq (DelayBuffer FIFO + head-of-line gate).
    void this.pool.acquire().then((release) => {
      const queueWaitMs = Date.now() - receiptTimeMs;
      console.log(
        `[mod] start server=${seq} (studio=${studioSeq}, wav=${wav ? 'yes' : 'no'}, ` +
          `queue=${queueWaitMs}ms, pool=${this.pool.depth}/${this.poolMax})`,
      );
      if (this.forceReleased.has(seq)) {
        // Censored by max hold while queued: skip the wasted model calls.
        // (The [hold] line already printed and decisions are already set.)
        release();
        return;
      }
      moderateChunk({
        seq,
        video,
        wav: windowWav,
        wavPrevMs,
        frameJpgs,
        prevFrameJpgs,
        receivedAtMs: receiptTimeMs,
        recentTranscript,
        tracker: this.tracker,
      })
        .then((res) => {
          if (this.forceReleased.has(seq)) {
            // Already released censored by max hold: keep the transcript for
            // judge context but don't overwrite the decisions or the log.
            // Still print the debug line (marked late) so no chunk vanishes silently.
            this.forceReleased.delete(seq);
            if (res.transcriptText.trim().length > 0) {
              this.transcriptWindow.push({ atMs: Date.now(), text: res.transcriptText });
            }
            console.log(
              `[debug] chunk #${seq} LATE (force-released earlier) lang=${res.debug.language} ` +
                `rule=${res.debug.matchedRule ?? 'none'} voice=${res.debug.timingsMs.voiceMs}ms ` +
                `sam=${res.debug.timingsMs.samMs}ms judge=${res.debug.timingsMs.judgeMs}ms ` +
                `transcript=${JSON.stringify(res.debug.transcript)}`,
            );
            return;
          }
          // Gesture tracker: fold this chunk's per-frame verdicts into the
          // per-rule history, rebuild the blur windows, and slice them to
          // this chunk. Applied before pads so tracked hits cast margins.
          const vision = res.debug.visionBreakdown;
          if (vision && vision.frameVerdicts.length > 0) {
            const chunkStartMs = seq * 2000;
            const keepFrom = chunkStartMs - VISION_HISTORY_MS;
            const byRule = new Map<string, FrameVerdict[]>();
            for (const fv of vision.frameVerdicts) {
              const list = byRule.get(fv.ruleId) ?? [];
              list.push({ tMs: fv.tMs, positive: fv.positive });
              byRule.set(fv.ruleId, list);
            }
            const windows: BlurWindow[] = [];
            for (const [ruleId, incoming] of byRule) {
              const merged = mergeFrameVerdicts(
                this.visionFrameHistory.get(ruleId) ?? [],
                incoming,
                keepFrom,
              );
              this.visionFrameHistory.set(ruleId, merged);
              windows.push(
                ...computeBlurWindows(merged, ruleId, releaseCleanFrames(), VISION_RANGE_MARGIN_MS),
              );
            }
            const slices = sliceWindowsToChunk(windows, chunkStartMs);
            for (const s of slices) {
              res.decisions.push(trackedBlurDecision(s.ruleId, s.startMs, s.endMs));
            }
            if (slices.length > 0 && (res.entry.action === 'allow' || res.entry.action === 'warn')) {
              const first = slices[0];
              const rule = ruleById(first.ruleId);
              res.entry.action = 'blur';
              res.entry.reason =
                (rule ? `rule ${rule.id}: ${rule.title}` : `rule ${first.ruleId}`) +
                ` tracked (${first.startMs}–${first.endMs}ms)` +
                (slices.length > 1 ? ` +${slices.length - 1} more` : '');
              res.entry.ruleId = first.ruleId;
            }
          }
          // Fallback whole-chunk bleeps yield to realtime coverage; a
          // previous-half hit copies a whole bleep onto the chunk before.
          if (this.realtimeBleepedSeqs.has(seq)) {
            const before = res.decisions.length;
            res.decisions = res.decisions.filter(
              (d) => !(d.action === 'bleep' && d.label === FALLBACK_LABEL),
            );
            if (res.decisions.length !== before) res.entry.reason += ' (fallback covered by realtime)';
          }
          if (res.debug.fallbackHitPrev && seq - 1 >= 0 && !this.realtimeBleepedSeqs.has(seq - 1)) {
            const ruleId =
              res.debug.fallbackRuleId ??
              res.decisions.find((d) => d.action === 'bleep' && d.label === FALLBACK_LABEL)?.ruleId;
            if (ruleId) this.applyBleep(seq - 1, fallbackBleepDecision(ruleId));
          }
          const stored = [...res.decisions, ...this.takeOwedPads(seq), ...this.takeOwedBleeps(seq)];
          // Only direct rule hits cast a margin: owed pads (label 'safety
          // margin') never cascade, but tracked gesture blurs are real hits.
          const directFlags = [
            ...new Set(
              res.decisions
                .filter((d) => d.action === 'blur' && d.ruleId && d.label !== PAD_LABEL)
                .map((d) => d.ruleId as string),
            ),
          ];
          const pad = blurPadChunks();
          if (directFlags.length > 0 && pad > 0) {
            for (const ruleId of directFlags) {
              for (let d = 1; d <= pad; d++) {
                this.applyPad(seq - d, ruleId, seq);
                this.applyPad(seq + d, ruleId, seq);
              }
            }
            res.entry.reason += ` (whole-frame blur, safety margin ±${pad} chunk${pad === 1 ? '' : 's'})`;
          }
          this.decisions.set(seq, stored);
          this.flushPendingInit(seq);
          this.chunkDebug.set(seq, res.debug);
          if (res.transcriptText.trim().length > 0) {
            this.transcriptWindow.push({ atMs: Date.now(), text: res.transcriptText });
          }
          this.pushLog(res.entry);
          const hourly = projectedHourlyUsd(this.tracker.totalUsd, Date.now() - this.streamStartMs);
          console.log(
            `[cost] chunk #${seq} mode=${res.mode} +$${res.costUsd.toFixed(4)} ` +
              `total=$${this.tracker.totalUsd.toFixed(4)} ~$${hourly.toFixed(2)}/h ` +
              `(cap $${maxSpendUsd()}, ${moderationMode()})`,
          );
          const judgeShow = res.debug.judgeSkipped ? 'skipped' : `${res.debug.timingsMs.judgeMs}ms`;
          console.log(
            `[debug] chunk #${seq} lang=${res.debug.language} rule=${res.debug.matchedRule ?? 'none'} ` +
              `queue=${res.debug.timingsMs.queueMs}ms voice=${res.debug.timingsMs.voiceMs}ms ` +
              `sam=${res.debug.timingsMs.samMs}ms judge=${judgeShow} ` +
              `transcript=${JSON.stringify(res.debug.transcript)}` +
              (Object.keys(res.debug.errors).length > 0
                ? ` errors=${JSON.stringify(res.debug.errors)}`
                : ''),
          );
        })
        .catch(() => {
          if (this.forceReleased.has(seq)) {
            this.forceReleased.delete(seq);
            return;
          }
          // Fail closed: viewers must never receive raw unmoderated media.
          const reason = 'moderation error; released fully censored (fail-closed)';
          this.decisions.set(seq, failClosedDecisions(reason));
          this.flushPendingInit(seq);
          this.chunkDebug.set(seq, {
            transcript: '',
            language: 'unknown',
            matchedRule: null,
            timingsMs: { queueMs: 0, voiceMs: 0, samMs: 0, judgeMs: 0 },
            judgeSkipped: true,
            errors: { vision: 'moderation pipeline error' },
          });
          this.pushLog({ seq, at: new Date().toISOString(), action: 'bleep', reason });
        })
        .finally(() => {
          this.pendingModeration.delete(seq);
          release();
        });
    });
  }

  /** Seqs currently held in the delay buffer (unreleased to viewers). */
  private bufferedSeqs(): Set<number> {
    return new Set(this.buffer.snapshot().map((c) => c.seq));
  }

  /** Take owed safety-margin blurs for a chunk being stored; prune stale keys. */
  private takeOwedPads(seq: number): Decision[] {
    const out: Decision[] = [];
    for (const [s, pads] of [...this.padOwed]) {
      if (s > seq) continue;
      this.padOwed.delete(s);
      if (s === seq) {
        for (const p of pads) out.push(padBlurDecision(p.ruleId, p.fromSeq));
      }
    }
    return out;
  }

  /** Match every realtime partial/final against banned spellings. */
  private onRealtimeTranscript(ev: { text: string; final: boolean; audioProcessedMs: number; turnId: string }): void {
    const session = this.realtime;
    if (!session) return;
    const baseMs = session.sessionStartStreamMs ?? 0;
    const tMs = baseMs + ev.audioProcessedMs;
    this.rtTracker.beginTurn(ev.turnId);
    const tokens = tokenizeTr(ev.text);
    if (tokens.length === 0) return;
    const hits = matchBanned(tokens, bannedSpellings());
    for (const hit of hits) {
      if (this.rtTracker.isClaimed(hit.ruleId, hit.token, hit.ordinal)) continue;
      this.rtTracker.claim(hit.ruleId, hit.token, hit.ordinal);
      // Cross-source occurrence dedupe: an exact hit and a fuzzy variant of
      // the same spoken word share (rule, time) but not the token text.
      this.rtScheduled = this.rtScheduled.filter((s) => tMs - s.tMs < 30_000);
      if (this.rtScheduled.some((s) => s.ruleId === hit.ruleId && Math.abs(tMs - s.tMs) < RT_OCCURRENCE_MS)) {
        console.log(
          `[rt-bleep] t=${Math.round(tMs)}ms rule=${hit.ruleId} token="${hit.token}" deduped (same occurrence)`,
        );
        continue;
      }
      this.rtScheduled.push({ ruleId: hit.ruleId, tMs });
      if (hit.exact) {
        this.applyRealtimeWindow(tMs, hit, false);
      } else {
        this.applyFuzzyWindow(tMs, hit, ev.text);
      }
    }
  }

  /** Exact match: bleep the lag-corrected word window across overlapped chunks. */
  private applyRealtimeWindow(tMs: number, hit: FuzzyHit, fuzzy: boolean): void {
    const w = realtimeBleepWindow(tMs, hit.token.length);
    const slices = mapRangeToChunks(w.startMs, w.endMs);
    for (const s of slices) {
      this.applyBleep(s.seq, realtimeBleepDecision(hit.ruleId, hit.token, s.startMs, s.endMs, fuzzy));
    }
    if (slices.length > 0) {
      console.log(
        `[rt-bleep] t=${Math.round(tMs)}ms rule=${hit.ruleId} token="${hit.token}" ` +
          `fuzzy=${fuzzy} seqs=[${slices.map((s) => s.seq).join(',')}]`,
      );
    }
  }

  /**
   * Fuzzy-only match: near-exact variants bleep at once; the rest ask the
   * judge when the delay budget allows, else bleep at once (fail-closed). A
   * judge allow cancels the pending bleep.
   */
  private applyFuzzyWindow(tMs: number, hit: FuzzyHit, context: string): void {
    const w = realtimeBleepWindow(tMs, hit.token.length);
    const slices = mapRangeToChunks(w.startMs, w.endMs);
    if (slices.length === 0) return;
    const receiptBySeq = new Map(this.buffer.snapshot().map((c) => [c.seq, c.receiptTimeMs]));
    const allReleased = slices.every(
      (s) => !receiptBySeq.has(s.seq) && !this.pendingModeration.has(s.seq) && s.seq < this.nextSeq,
    );
    if (allReleased) {
      console.log(`[rt-bleep] fuzzy t=${Math.round(tMs)}ms already aired; dropping`);
      return;
    }
    if (isNearExact(hit.distance)) {
      this.applyRealtimeWindow(tMs, hit, false);
      console.log(
        `[rt-bleep] fuzzy t=${Math.round(tMs)}ms rule=${hit.ruleId} token="${hit.token}" ` +
          `near-exact (d=${hit.distance}); judge skipped`,
      );
      return;
    }
    const deadlineMs = Math.max(
      ...slices.map((s) => (receiptBySeq.get(s.seq) ?? Date.now()) + this.buffer.delay),
    );
    const floatMs = deadlineMs - Date.now();
    if (floatMs < FUZZY_JUDGE_BUDGET_MS) {
      this.applyRealtimeWindow(tMs, hit, true);
      console.log(
        `[rt-bleep] fuzzy t=${Math.round(tMs)}ms rule=${hit.ruleId} float=${Math.round(floatMs)}ms ` +
          `< ${FUZZY_JUDGE_BUDGET_MS}ms budget; judge skipped, bleeping at once`,
      );
      return;
    }
    let resolved = false;
    const fire = (): void => {
      if (resolved) return;
      resolved = true;
      for (const s of slices) {
        this.applyBleep(s.seq, realtimeBleepDecision(hit.ruleId, hit.token, s.startMs, s.endMs, true));
      }
      console.log(
        `[rt-bleep] fuzzy t=${Math.round(tMs)}ms rule=${hit.ruleId} fail-closed ` +
          `(float was ${Math.round(floatMs)}ms, no judge verdict in time)`,
      );
    };
    const timer = setTimeout(() => {
      this.fuzzyTimers.delete(timer);
      fire();
    }, Math.max(0, floatMs));
    if (typeof timer.unref === 'function') timer.unref();
    this.fuzzyTimers.add(timer);
    const judgeStart = Date.now();
    judgeContext(
      { recentTranscript: this.recentTranscript(), chunkTranscript: context },
      this.tracker.capped ? 'mock' : 'live',
    )
      .then((j) => {
        this.tracker.add(j.costUsd);
        if (resolved) return;
        const judgeMs = Date.now() - judgeStart;
        if (j.verdict.action === 'bleep' || j.verdict.action === 'warn') {
          console.log(
            `[rt-bleep] fuzzy t=${Math.round(tMs)}ms rule=${hit.ruleId} judge=${j.verdict.action} in ${judgeMs}ms`,
          );
          fire();
        } else {
          resolved = true;
          clearTimeout(timer);
          this.fuzzyTimers.delete(timer);
          console.log(
            `[rt-bleep] fuzzy t=${Math.round(tMs)}ms rule=${hit.ruleId} allowed by judge in ${judgeMs}ms`,
          );
        }
      })
      .catch(() => {
        // Judge failure leaves the fail-closed timer to bleep in time.
      });
  }

  /**
   * Attach a bleep to a buffered chunk: stored + still held appends now;
   * future or still moderating is owed for store time; already released is
   * too late. Owed/stored bleeps mark the chunk realtime-covered.
   */
  private applyBleep(victimSeq: number, decision: Decision): void {
    if (victimSeq < 0 || this.forceReleased.has(victimSeq)) return;
    const stored = this.decisions.get(victimSeq);
    if (stored) {
      if (!this.bufferedSeqs().has(victimSeq)) return;
      // Merge in place: same-rule overlaps become one union window.
      const merged = mergeBleepWindow(stored, decision);
      stored.length = 0;
      stored.push(...merged);
      this.realtimeBleepedSeqs.add(victimSeq);
      return;
    }
    if (
      victimSeq >= this.nextSeq ||
      this.bufferedSeqs().has(victimSeq) ||
      this.pendingModeration.has(victimSeq)
    ) {
      const owed = this.bleepOwed.get(victimSeq) ?? [];
      this.bleepOwed.set(victimSeq, mergeBleepWindow(owed, decision));
      this.realtimeBleepedSeqs.add(victimSeq);
    }
  }

  /** Take owed realtime bleeps for a chunk being stored; prune stale keys. */
  private takeOwedBleeps(seq: number): Decision[] {
    const out: Decision[] = [];
    for (const [s, bleeps] of [...this.bleepOwed]) {
      if (s > seq) continue;
      this.bleepOwed.delete(s);
      if (s === seq) out.push(...bleeps);
    }
    return out;
  }

  /**
   * Blur a chunk neighboring a flagged one. Stored + still held: append
   * now. Future or still moderating: owe it for store time (deduped per
   * rule). Already released: too late (force-released ones blur anyway).
   */
  private applyPad(victimSeq: number, ruleId: string, fromSeq: number): void {
    if (victimSeq < 0 || this.forceReleased.has(victimSeq)) return;
    const stored = this.decisions.get(victimSeq);
    if (stored) {
      if (!this.bufferedSeqs().has(victimSeq)) return;
      if (stored.some((d) => d.action === 'blur' && d.ruleId === ruleId && d.label === PAD_LABEL)) {
        return;
      }
      stored.push(padBlurDecision(ruleId, fromSeq));
      return;
    }
    if (
      victimSeq >= this.nextSeq ||
      this.bufferedSeqs().has(victimSeq) ||
      this.pendingModeration.has(victimSeq)
    ) {
      const owed = this.padOwed.get(victimSeq) ?? [];
      if (!owed.some((p) => p.ruleId === ruleId)) owed.push({ ruleId, fromSeq });
      this.padOwed.set(victimSeq, owed);
    }
  }

  /** DEBUG_CAPTURE=1: persist the exact moderation inputs for soak:live replay. */
  private captureChunk(
    seq: number,
    video: Buffer,
    wav: Buffer | null,
    frameJpgs: Buffer[],
    receiptTimeMs: number,
  ): void {
    const dir = captureDir();
    if (!dir) return;
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `chunk${seq}.webm`), video);
      if (wav) writeFileSync(join(dir, `chunk${seq}.wav`), wav);
      frameJpgs.forEach((jpg, i) => writeFileSync(join(dir, `chunk${seq}-f${i}.jpg`), jpg));
      appendFileSync(
        join(dir, 'manifest.jsonl'),
        JSON.stringify({
          seq,
          receivedAtMs: receiptTimeMs,
          hasWav: !!wav,
          hasJpg: frameJpgs.length > 0,
        }) + '\n',
      );
    } catch (e) {
      console.log(`[capture] chunk #${seq} save failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** 5s load line: OS load, process CPU, event-loop lag, ffmpeg, pool, sockets. */
  private logStats(): void {
    const cpu = process.cpuUsage(this.lastCpu);
    this.lastCpu = process.cpuUsage();
    const cpuPct = ((cpu.user + cpu.system) / (STATS_INTERVAL_MS * 1000)) * 100;
    const sockets = process
      .getActiveResourcesInfo()
      .filter((t) => t.toLowerCase().includes('socket')).length;
    const heapMb = Math.round(process.memoryUsage().heapUsed / 1048576);
    console.log(
      `[stats] load=${loadavg()[0].toFixed(2)} cpu=${cpuPct.toFixed(0)}% ` +
        `loopP50=${(this.loopDelay.mean / 1e6).toFixed(1)}ms ` +
        `loopP99=${(this.loopDelay.percentile(99) / 1e6).toFixed(1)}ms ` +
        `loopMax=${(this.loopDelay.max / 1e6).toFixed(0)}ms ` +
        `ffmpeg=${ffmpegActiveChildren()} pool=${this.pool.depth}/${this.poolMax} ` +
        `poolQueue=${this.pool.pending} buffer=${this.buffer.size} ` +
        `socks=${sockets} heap=${heapMb}MB`,
    );
    this.loopDelay.reset();
  }

  private recentTranscript(): string {
    const cutoff = Date.now() - 60_000;
    while (this.transcriptWindow.length > 0 && this.transcriptWindow[0].atMs < cutoff) {
      this.transcriptWindow.shift();
    }
    return this.transcriptWindow.map((t) => t.text).join(' ');
  }

  /**
   * Max hold: a chunk still unmoderated past delay + maxOverdue is released
   * blurred and bleeped in full instead of blocking the queue behind it.
   */
  private forceReleaseOverdue(nowMs: number): void {
    for (const chunk of this.buffer.snapshot()) {
      if (!this.pendingModeration.has(chunk.seq)) continue;
      if (nowMs - chunk.receiptTimeMs <= this.buffer.delay + this.maxOverdueMs) continue;
      this.pendingModeration.delete(chunk.seq);
      this.padOwed.delete(chunk.seq); // force-release blurs in full already
      this.forceReleased.add(chunk.seq);
      const reason =
        `moderation unavailable: unmoderated ${this.maxOverdueMs}ms past the delay; ` +
        'released blurred and bleeped in full';
      this.decisions.set(chunk.seq, [
        { action: 'bleep', reason, startMs: 0, endMs: 2000 },
        {
          action: 'blur',
          reason,
          startMs: 0,
          endMs: 2000,
          box: { x: 0, y: 0, w: 1, h: 1 },
          label: 'full frame (max hold exceeded)',
        },
      ]);
      this.flushPendingInit(chunk.seq);
      this.chunkDebug.set(chunk.seq, {
        transcript: '',
        language: 'unknown',
        matchedRule: null,
        timingsMs: { queueMs: nowMs - chunk.receiptTimeMs, voiceMs: 0, samMs: 0, judgeMs: 0 },
        judgeSkipped: false,
        errors: { vision: `max hold exceeded (${this.maxOverdueMs}ms past the delay)` },
      });
      this.pushLog({ seq: chunk.seq, at: new Date().toISOString(), action: 'bleep', reason });
      console.log(
        `[hold] chunk #${chunk.seq} force-released censored ` +
          `(unmoderated ${nowMs - chunk.receiptTimeMs - this.buffer.delay}ms past the delay)`,
      );
    }
  }

  private flush(): void {
    const nowMs = Date.now();
    this.forceReleaseOverdue(nowMs);
    const due = this.buffer.popDue(nowMs, (chunk) => !this.pendingModeration.has(chunk.seq));
    if (due.length > 0) {
      for (const chunk of due) {
        const decisions = this.decisions.get(chunk.seq) ?? [];
        const debug = this.chunkDebug.get(chunk.seq);
        for (const ws of [...this.viewers]) {
          if (ws.readyState !== 1) {
            this.viewers.delete(ws);
            this.startedViewers.delete(ws);
            continue;
          }
          // Held for init: chunk 0's decisions gate their first bytes.
          // Nothing is missed — nothing releases before chunk 0 moderates.
          if (this.pendingInit.has(ws)) continue;
          const init = !this.startedViewers.has(ws);
          this.sendChunk(ws, { seq: chunk.seq, data: chunk.data, init, decisions, debug });
          this.startedViewers.add(ws);
        }
      }
      const lags = due.map((c) => nowMs - c.receiptTimeMs);
      console.log(
        `[tx] released seqs=[${due.map((c) => c.seq).join(',')}] ` +
          `receipt-to-release=${Math.min(...lags)}..${Math.max(...lags)}ms`,
      );
    }
    this.pumpDrain();
  }

  /**
   * While ending: report held chunks to the publisher (on change), and once
   * the buffer has fully played out, mark the stream ended for everyone.
   * Viewers are never cut: end-of-stream goes out only after their last byte.
   */
  private pumpDrain(): void {
    if (!this.ending || this.endAnnounced) return;
    // pendingModeration is always a subset of the buffer (chunks leave the
    // buffer only after moderation settles), so buffer.size is the full drain.
    const left = this.buffer.size;
    if (left !== this.lastDrainSent) {
      this.lastDrainSent = left;
      if (this.publisher) {
        this.sendJson(this.publisher, { type: 'drain', pending: left } satisfies DrainProgressMessage);
      }
    }
    if (!this.streamOver) return;
    this.endAnnounced = true;
    if (this.publisher) {
      this.sendJson(this.publisher, { type: 'ended' } satisfies StreamEndedMessage);
    }
    for (const ws of [...this.viewers]) {
      if (this.endedViewers.has(ws)) continue;
      this.endedViewers.add(ws);
      this.pendingInit.delete(ws);
      this.sendJson(ws, { type: 'end' } satisfies EndOfStreamMessage);
    }
    console.log('[end] delayed stream fully played out; ended notifications sent.');
  }

  private sendChunk(
    ws: WebSocket,
    args: { seq: number; data: Buffer; init: boolean; decisions: Decision[]; debug?: ChunkDebug },
  ): void {
    const meta: ChunkMetaMessage = {
      type: 'chunk',
      seq: args.seq,
      init: args.init,
      decisions: args.decisions,
      receiptTimeMs: Date.now(),
      ...(args.debug ? { debug: args.debug } : {}),
    };
    ws.send(JSON.stringify(meta));
    ws.send(args.data);
  }

  private pushLog(entry: ModerationLogEntry): void {
    this.log.push(entry);
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
    if (this.publisher && this.publisher.readyState === 1) {
      const msg: LogBroadcast = { type: 'log', entry };
      this.publisher.send(JSON.stringify(msg));
    }
  }
}
