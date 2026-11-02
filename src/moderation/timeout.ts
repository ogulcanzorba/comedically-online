/** Per-model-call timeout (ms). A timed-out call throws and is treated as an error. */
export const MODEL_TIMEOUT_MS = 6000;

export interface TimeoutScope {
  signal: AbortSignal;
  cancel: () => void;
  /** Throw a timeout error if the scope already aborted (for APIs that end silently). */
  throwIfAborted: (label: string) => void;
}

export function startTimeout(ms: number = MODEL_TIMEOUT_MS): TimeoutScope {
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
