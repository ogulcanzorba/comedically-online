'use client';

import { useEffect, useRef, useState } from 'react';

/** Self-view camera preview for rehearsal. Nothing here broadcasts. */
export function PrepareCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    async function start(): Promise<void> {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        if (!cancelled) setError('Camera unavailable. Check permissions to rehearse your framing.');
      }
    }
    void start();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div>
      {error ? (
        <p className="rounded-md bg-neutral-900 p-6 text-sm text-neutral-400">{error}</p>
      ) : (
        <video ref={videoRef} muted playsInline className="aspect-video w-full rounded-md bg-black" aria-label="Self-view camera preview" />
      )}
    </div>
  );
}
