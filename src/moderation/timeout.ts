/**
 * Per-model call timeouts (ms). A timed-out call throws and is treated as
 * an error by the pipeline. Overridable via env for slow networks/rehearsal.
 */
function envMs(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Muse Voice Transcribe timeout. Default 8s. */
export function voiceTimeoutMs(): number {
  return envMs('VOICE_TIMEOUT_MS', 8_000);
}

/** SAM 3.1 video timeout. Default 20s: video segmentation is the slow stage. */
export function samTimeoutMs(): number {
  return envMs('SAM_TIMEOUT_MS', 20_000);
}

/**
 * SAM 3.1 image timeout. Default 6s: image calls normally finish in ~1s, so
 * a slow call fails closed fast instead of eating pool time with retries.
 */
export function samImageTimeoutMs(): number {
  return envMs('SAM_IMAGE_TIMEOUT_MS', 6_000);
}

/** muse-spark judge timeout. Default 8s. */
export function sparkTimeoutMs(): number {
  return envMs('SPARK_TIMEOUT_MS', 8_000);
}

/**
 * Spark VLM gate timeout per frame call. Default 8s: minimal-effort calls
 * normally finish in ~2s, so a slow call fails fast into visual fail handling.
 */
export function gateTimeoutMs(): number {
  return envMs('GATE_TIMEOUT_MS', 8_000);
}

/**
 * Spark multi-frame vision timeout per call. Bounded by MAX_HOLD_MS: a call
 * that cannot finish inside the max-hold window blurs the chunk instead of
 * stalling the relay. GATE_TIMEOUT_MS caps it further when lower.
 */
export function sparkVisionTimeoutMs(): number {
  const hold = Number(process.env.MAX_HOLD_MS ?? 4_000);
  const holdMs = Number.isFinite(hold) && hold > 0 ? hold : 4_000;
  return Math.min(gateTimeoutMs(), holdMs);
}

export interface TimeoutScope {
  signal: AbortSignal;
  cancel: () => void;
  /** Throw a timeout error if the scope already aborted (for APIs that end silently). */
  throwIfAborted: (label: string) => void;
}

export function startTimeout(ms: number): TimeoutScope {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  if (typeof timer.unref === 'function') timer.unref();
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
    throwIfAborted: (label: string) => {
      if (controller.signal.aborted) throw new Error(`${label} timed out after ${ms}ms`);
    },
  };
}
