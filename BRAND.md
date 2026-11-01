# Comedically Online — Brand (v1)

## Idea

A comedy club that takes the craft seriously: near-black room, hot spotlight, one warm
accent. Premium, not neon; playful, not clownish.

## Palette

| Token      | Hex     | Use                                              |
| ---------- | ------- | ------------------------------------------------ |
| ink        | #0b0b12 | Page background, text on light elements          |
| spotlight  | #ffc53d | Primary CTAs, logo glow, focus rings, selection  |
| coral      | #ff6b5b | Secondary accent (logo base, live-adjacent bits) |

Neutrals come from Tailwind's zinc/neutral ramp. Interim `amber-*` shades on older
pages are visually adjacent stand-ins and converge to `spotlight` over time.

Why these: yellow reads as stage light instantly; deep ink keeps contrast AAA on body
text; coral adds warmth without the purple-gradient AI cliché.

## Type

- Display: **Fraunces** (via `next/font`, self-hosted at build, no runtime CDN) —
  showbill character with optical sizing, used for headlines via `font-serif`.
- Body: **Public Sans** (same setup) — neutral, highly legible at small sizes.

## Logo

Inline SVG (`src/components/Logo.tsx`): a microphone head glowing spotlight-yellow
under a translucent light cone, coral base line, plus a serif wordmark. Same artwork
powers `src/app/icon.svg` (favicon) on an ink rounded square. No image files, no CDN.

## OG image

Generated at request time by `src/app/opengraph-image.tsx` (`next/og`): ink
background, wordmark, tagline, and the two CTA shapes. Matches the landing hero.

## Voice

Short, dry, confident. Never punch down; the product jokes about the room, never the
user. Legal and safety copy stays plain and honest (see the template banners).
