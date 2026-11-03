import { activeBlursAt, isBleepedAt, type CensorPlan } from './censor-plan';

/**
 * Render a censored video file in the browser: frames are redrawn on a
 * canvas with blur regions applied, audio runs through a gain node muted
 * during bleep windows, and the result is re-encoded to WebM. Everything
 * happens on-device; the source never leaves the tab. Rendering runs in
 * real time, so a full broadcast takes as long as the broadcast did.
 */
export async function renderCensoredVideo(
  srcUrl: string,
  plan: CensorPlan,
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  const video = document.createElement('video');
  video.muted = true;
  (video as HTMLVideoElement & { playsInline?: boolean }).playsInline = true;
  video.preload = 'auto';
  video.src = srcUrl;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('could not decode video'));
  });
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');

  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) throw new Error('Web Audio unavailable');
  const audioCtx = new AC();
  await audioCtx.resume().catch(() => {});
  const source = audioCtx.createMediaElementSource(video);
  const gain = audioCtx.createGain();
  const dest = audioCtx.createMediaStreamDestination();
  source.connect(gain);
  gain.connect(dest);

  const out = canvas.captureStream(30);
  for (const track of dest.stream.getAudioTracks()) out.addTrack(track);
  const mimeType =
    ['video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ??
    '';
  const recorder = new MediaRecorder(out, mimeType ? { mimeType } : undefined);
  const parts: Blob[] = [];
  recorder.ondataavailable = (ev: BlobEvent) => {
    if (ev.data.size > 0) parts.push(ev.data);
  };
  const recorded = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error('encode failed'));
  });

  let raf = 0;
  const draw = (): void => {
    const t = video.currentTime;
    ctx.filter = 'none';
    ctx.drawImage(video, 0, 0, width, height);
    for (const box of activeBlursAt(plan, t)) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(box.x * width, box.y * height, box.w * width, box.h * height);
      ctx.clip();
      ctx.filter = 'blur(12px)';
      ctx.drawImage(canvas, 0, 0);
      ctx.restore();
    }
    ctx.filter = 'none';
    gain.gain.value = isBleepedAt(plan, t) ? 0 : 1;
    if (video.duration > 0) onProgress?.(Math.min(1, t / video.duration));
    raf = requestAnimationFrame(draw);
  };

  try {
    video.currentTime = 0;
    await video.play().catch(() => {
      throw new Error('playback blocked');
    });
    recorder.start(500);
    draw();
    await new Promise<void>((resolve, reject) => {
      video.onended = () => resolve();
      video.onerror = () => reject(new Error('decode failed during render'));
      // Real-time render: allow the full duration plus startup margin.
      const budgetMs = Math.max(60_000, (plan.durationS + 30) * 1000);
      window.setTimeout(() => reject(new Error('render timed out')), budgetMs);
    });
  } finally {
    cancelAnimationFrame(raf);
    if (recorder.state !== 'inactive') recorder.stop();
    await recorded.catch(() => {});
    await audioCtx.close().catch(() => {});
  }
  if (parts.length === 0) throw new Error('render produced no data');
  return new Blob(parts, { type: 'video/webm' });
}
