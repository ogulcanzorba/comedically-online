/** Blur strength shared by the viewer, recap, and download renderers. */
export const DEFAULT_BLUR_PX = 28;

/**
 * Blur radius in px. NEXT_PUBLIC_BLUR_PX wins in the browser (BLUR_PX is the
 * plain-node fallback, handy for tests). Anything invalid falls back to 28.
 */
export function blurPx(): number {
  const raw = Number(
    process.env.NEXT_PUBLIC_BLUR_PX ?? process.env.BLUR_PX ?? DEFAULT_BLUR_PX,
  );
  return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : DEFAULT_BLUR_PX;
}

/** Pixel block size for the pixelate pass (download renderer). */
export const PIXEL_BLOCK = 12;
