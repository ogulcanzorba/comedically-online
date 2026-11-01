import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OgImage(): Response {
  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: 96,
          background: '#0b0b12',
          color: '#f4f4f5',
        }}
      >
        <div style={{ display: 'flex', fontSize: 44, fontWeight: 700 }}>
          Comedically&nbsp;<span style={{ color: '#ffc53d' }}>Online</span>
        </div>
        <div style={{ display: 'flex', fontSize: 76, fontWeight: 800, marginTop: 16, lineHeight: 1.1 }}>
          Live comedy.
        </div>
        <div style={{ display: 'flex', fontSize: 40, color: '#a1a1aa', marginTop: 8 }}>
          Moderated by someone who gets the joke.
        </div>
        <div style={{ display: 'flex', marginTop: 32, gap: 12 }}>
          <div style={{ background: '#ffc53d', color: '#0b0b12', fontSize: 28, fontWeight: 700, padding: '12px 28px', borderRadius: 8 }}>
            Watch live
          </div>
          <div style={{ border: '2px solid #52525b', fontSize: 28, padding: '12px 28px', borderRadius: 8 }}>
            Go live as a comedian
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
