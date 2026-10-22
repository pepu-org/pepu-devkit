# PEPU template brand system

Every PEPU starter template looks like one family: dark green surfaces, PEPU
green for actions, a single lime accent. This file is the source of truth for
new templates. The implementation is one CSS file, `templates/_design/pepu-design.css`,
copied verbatim into each template as `app/pepu-design.css` (templates are
scaffolded standalone, so they cannot import from a sibling directory).

Workflow:

```sh
# edit templates/_design/*  (css + shared components), then:
node templates/scripts/sync-design.mjs    # copy into every template
node templates/scripts/check-design.mjs   # fail on drift or sub-AA contrast
```

## Where the brand came from

Extracted on 2026-10-01 from the live stylesheets, not invented.

| Source | What we read |
| --- | --- |
| `https://pepeunchained.com` (`styles-*.css`, a Bootstrap 5 build with a custom theme) | Theme variables `--bs-primary #072308`, `--bs-secondary #D0FF00`, `--bs-tertiary #243E26`, `--bs-background #051706`, `--bs-success #0E9B09`, `--bs-danger #CF1E0E`, `--bs-warning #9E9626`, `--bs-light #EAEAEA`, `--bs-grey #8D8080`. Display font `Grandstander` (Google Font, variable 100-900, loaded from `fonts.gstatic.com`). Body font is the Bootstrap system stack. Primary CTA is a pill (`border-radius: 48px`) with a dark-to-lime gradient. Hover green `#32AA2E`, active green `#3EAF3A`. |
| `https://pepuscan.com` (Blockscout/Chakra build) | Neutral dark explorer chrome (`black #101112`, grays), Inter and Poppins fonts. No green of its own. We treat it as the "neutral explorer" register and deliberately follow the main site's green identity for app UI. |

### What we could not extract (client to supply)

- **A documented type scale, spacing scale, or motion spec.** The site does not
  publish one; the scales below are ours.
- **Light theme.** The brand is dark-first and the templates ship dark only.
- Pepuscan's CSS is a hashed Chakra bundle with almost no custom values, so
  there was nothing brand-specific to lift from it beyond the neutral black.

## Official icon

The client supplied the official Pepe Unchained icon as `pepu.svg` (repo root).
It is the brand mark in every template. Do not redraw it.

| Fact | Detail |
| --- | --- |
| Source | `pepu.svg` at the repo root, as supplied by the client. 654 KB, `viewBox 0 0 30 30`. |
| What it really is | A raster: a 1287x1288 PNG embedded in an SVG `<pattern>`, not vector paths. It does not scale up cleanly beyond roughly 256 px. |
| Background | Transparent (PNG alpha). The `<path>` wrapper is only a crop window, not a fill. Works on the dark theme as is. |
| Artwork | Pepe with the circuit-brain. Black outline, green face, pink brain. The black outline disappears on dark surfaces but the colour fills carry the shape, so it stays legible. |
| Optimised copy | `_design/assets/pepu-logo.svg`: the same pixels cropped to the artwork's own window (transparent padding trimmed), resized to 192 px and palette-quantised: 13 KB. Artwork unchanged. |

Files (canonical in `templates/_design/assets/`, copied into each template by
`sync-design.mjs`, drift-checked by `check-design.mjs`):

| Canonical | In each template | Use |
| --- | --- | --- |
| `pepu-logo.svg` | `public/pepu-logo.svg` | In-app mark, rendered by `components/pepu-mark.tsx` |
| `icon.svg` | `app/icon.svg` | Browser tab icon (Next file convention) |
| `favicon.ico` | `app/favicon.ico` | 16/32/48 fallback |
| `apple-icon.png` | `app/apple-icon.png` | 180 px touch icon, mark on `canvas` `#051706` (iOS fills transparency with black) |

Usage rules:

- Use it in the header beside the app name and on the setup (missing-config)
  and sign-in screens. One mark per screen region; do not tile or repeat it.
- Minimum size 16 px (favicon); 24 px in UI. Preferred 32-48 px. Above about
  128 px it will look soft, so request a larger master from the client first.
- Clear space: at least a quarter of the mark's width on every side.
- Background: dark surfaces only (`canvas`, `surface`, `raised`). Do not place
  it on lime or on a light fill without a dark tile behind it.
- Do not recolour, stretch, rotate, crop into a roundel, add outlines or
  swap in the old "P". The soft green glow in `PepuMark` is the only effect.
- Accessibility: beside visible text it is decorative (`alt=""`,
  `aria-hidden`). Standing alone as the brand link, use
  `<PepuMark decorative={false} />` (alt "Pepe Unchained").
- No template defines OpenGraph/Twitter images yet. When one is added, centre
  this mark on `canvas`.

## Palette

`src` = lifted from the client's CSS. `derived` = computed by us from a src
value to reach a contrast target on dark surfaces.

| Token (Tailwind utility) | Hex | Origin |
| --- | --- | --- |
| `canvas` | `#051706` | src `--bs-background` (page) |
| `surface` | `#072308` | src `--bs-primary` (cards, base) |
| `raised` | `#0C2D0F` | derived (card top, inputs, chips) |
| `overlay` | `#123816` | derived (hover on raised) |
| `line` | `#243E26` | src `--bs-tertiary` (borders) |
| `line-strong` | `#4F7A52` | derived (input edge, 3.38:1 on surface) |
| `ink` | `#EAEAEA` | src `--bs-light` (primary text) |
| `ink-soft` | `#C5D3C5` | derived (secondary text) |
| `ink-muted` | `#9DB39F` | derived (captions; green-tinted stand-in for their warm grey `#8D8080`, 8.3:1 on canvas) |
| `pepu-300` | `#7FD979` | derived (green text and links on dark) |
| `pepu-400` | `#3EAF3A` | src (their `.btn-success` active) |
| `pepu-500` | `#0E9B09` | src `--bs-success` (the PEPU green) |
| `pepu-600` | `#0B7D07` | derived |
| `lime` | `#D0FF00` | src `--bs-secondary` (the accent: focus ring, key numbers, success) |
| `on-brand` | `#051706` | label colour on green and lime fills |
| `warn` / `warn-bg` / `warn-line` | `#E6DC6E` / `#1D1C08` / `#6B6520` | derived from src `#9E9626` |
| `danger` / `danger-bg` / `danger-line` | `#FF8A7D` / `#2A0E0B` / `#8A3027` | derived from src `#CF1E0E` |
| `info` / `info-bg` / `info-line` | `#8FD3E8` / `#0A2230` / `#2A5A70` | derived (neutral "heads up" only) |

Usage rules:

- Primary action = green gradient pill with dark label (`btn btn-primary`).
- Lime is an accent, used sparingly: focus ring, the one key number on a
  screen, the success tick, link hover. Never as a large fill behind text.
- Green text on dark uses `pepu-300`, never `pepu-500` (3.4:1 would fail).
- Warnings and errors always carry a text title, never colour alone.

## Typography

| Role | Font | Notes |
| --- | --- | --- |
| Display (h1-h3, wordmark, big numbers) | Grandstander | Loaded in `app/layout.tsx` with `next/font/google` (`--font-grandstander`), self-hosted at build time. Exposed as `font-display`. |
| Body / UI | system stack (`system-ui, -apple-system, Segoe UI, Roboto`) | Same as the client site. `font-sans`. |
| Code / addresses | `ui-monospace` stack | `font-mono`, `.code`, `.code-block`. |

Scale: eyebrow 12px / 600 / +0.08em uppercase; caption 12px; body 14-16px
(inputs 16px to prevent iOS zoom); card title 20-24px display; hero 30-48px
display, line-height 1.1; hero numbers 36px display, tabular numerals.

## Spacing, radius, elevation

- Page gutter 16px (phone) / 24-32px (sm+). Card padding 20px / 24px.
  Vertical rhythm `space-y-3/4`. Content width `max-w-md` (app) / `max-w-lg`
  (setup, consent) / `max-w-2xl` (demo).
- Radius: pill (999px) for buttons and chips, 16px cards, 12px inputs and
  wells, 8px code chips.
- Elevation is layered, not flat: canvas (with a soft green top glow) ->
  surface -> raised, each with a 1px `line` border and an inset top highlight.
  `card-featured` adds a green edge and glow for the one hero card per screen.

## Motion rules

- Durations 150ms (press, link colour) and 200ms (hover, border), entrance 260ms.
  Easing `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- Every interactive element has hover, focus-visible (2px lime ring) and press
  states. Primary buttons lift 1px on hover and scale to 0.96 on press.
- Loading: spinner (`.spinner`) in buttons and for page waits, shimmer
  skeleton (`.skeleton`) wherever a number will land so the layout does not jump.
- Success: `SuccessCheck` (pop, draw tick, one ring) for confirmed
  transactions, copy, unlock. The tap game also floats a "+1".
- `prefers-reduced-motion: reduce` turns off entrances, lifts, scale, floats,
  rings and shimmer. The spinner becomes a gentle pulse, since it carries
  information.

## Honesty UI is part of the system

Restyle, never hide or shrink:

- `GasNotice` (`notice notice-honest`, lime left rule, body text 14px at
  10:1 contrast) in every non-sponsored template.
- The session-key consent screen: a featured card, one `well` per scope item
  at 14px, and the "How this is actually enforced" disclosure as a `notice-warn`
  with a 16px title. It must read as primary content, not fine print.
- Embedded vs external wallet labels stay as text, with a tone (green vs warn
  tint) as reinforcement only.

## Mobile

Every template is mobile-first at 360px: 16px inputs (stops iOS zoom-on-focus),
44px minimum touch targets, bottom padding that includes
`env(safe-area-inset-bottom)`, `viewport-fit=cover` and `themeColor`. The dark
theme is fixed.
