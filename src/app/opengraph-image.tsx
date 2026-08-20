import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'
import specJson from '../../spec/spec.json'
import type { Spec } from '@/lib/types'
import { TALENT_WORDMARK_PATHS, TALENT_WORDMARK_VIEWBOX } from '@/components/brand/talent-wordmark-paths'

// The link preview for every route that doesn't declare its own. Rendered from
// spec.json at build time, so the card states the same credential counts the
// credentials page does — it can go stale only if the spec does.

export const alt =
  'Open Builder Score — every point comes with the exact formula that produced it. talentprotocol.com'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const spec = specJson as Spec

// The dark theme's tokens (globals.css), hardcoded: Satori has no CSS variables
// and the app defaults to dark, so this is the card people see.
const GROUND = '#0a0a0a' // neutral-950 — background
const TYPE = '#fafafa' // neutral-50 — foreground
const MUTED = '#a3a3a3' // neutral-400 — muted type, one step up from the
// app's muted-foreground so the small print survives a timeline thumbnail
const RULE = '#262626' // neutral-800 — border
const SURFACE = '#171717' // neutral-900 — card
const CODE = '#d4d4d4' // neutral-300 — code, one step under foreground
const SIGNAL = '#10b981' // emerald-500 — signal; carries meaning only

const PAD = 72
const GRID_PITCH = 44 // the app's blueprint grid is 22px; doubled to survive
// the ~2.4x downscale a timeline thumbnail applies.

function gridDataUri(): string {
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`
  const lines: string[] = []
  for (let x = 0; x <= size.width; x += GRID_PITCH) lines.push(line(x, 0, x, size.height))
  for (let y = 0; y <= size.height; y += GRID_PITCH) lines.push(line(0, y, size.width, y))
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}">` +
    `<g stroke="${SIGNAL}" stroke-opacity="0.1" stroke-width="1">${lines.join('')}</g></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

function wordmarkDataUri(): string {
  const paths = TALENT_WORDMARK_PATHS.map((d) => `<path d="${d}"/>`).join('')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${TALENT_WORDMARK_VIEWBOX}" fill="${TYPE}">` +
    `${paths}</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

function font(file: string) {
  return readFile(join(process.cwd(), 'src/app/_og-fonts', file))
}

// spec.scoring.per_credential verbatim, wrapped to fit the card. The test
// asserts these lines still reassemble into the spec's formula.
export const FORMULA_LINES = [
  'points = min(',
  '  round(convert(value) × multiplier),',
  '  max_score',
  ')',
]

export default async function OpengraphImage() {
  const [calSans, mono, monoMedium] = await Promise.all([
    font('CalSans-Regular.ttf'),
    font('GeistMono-Regular.ttf'),
    font('GeistMono-Medium.ttf'),
  ])

  const counted = spec.credentials.filter((c) => c.status === 'active').length
  const uncounted = spec.credentials.length - counted

  return new ImageResponse(
    (
      <div
        style={{
          width: size.width,
          height: size.height,
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: GROUND,
          fontFamily: 'Geist Mono',
          position: 'relative',
        }}
      >
        <img
          src={gridDataUri()}
          alt=""
          width={size.width}
          height={size.height}
          style={{ position: 'absolute', top: 0, left: 0 }}
        />

        {/* Masthead — the app header's h-12 rule, scaled up */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: 92,
            padding: `0 ${PAD}px`,
            borderBottom: `1px solid ${RULE}`,
          }}
        >
          <img src={wordmarkDataUri()} alt="talent" width={95} height={26} />
          <div style={{ display: 'flex', fontSize: 22, color: MUTED, letterSpacing: 2 }}>
            {`OPEN BUILDER SCORE · v${spec.version}`}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 40,
            padding: `0 ${PAD}px`,
          }}
        >
          <div
            style={{
              display: 'flex',
              fontFamily: 'Cal Sans',
              fontSize: 58,
              lineHeight: 1.12,
              letterSpacing: -0.5,
              color: TYPE,
              maxWidth: 880,
            }}
          >
            Every point comes with the exact formula that produced it.
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignSelf: 'flex-start',
              backgroundColor: SURFACE,
              border: `1px solid ${RULE}`,
              borderRadius: 10,
              padding: '24px 30px',
              fontSize: 30,
              lineHeight: 1.5,
              color: CODE,
            }}
          >
            {FORMULA_LINES.map((line, i) => (
              <div key={line} style={{ display: 'flex', whiteSpace: 'pre' }}>
                {i === 0 ? (
                  <>
                    <div style={{ display: 'flex', color: SIGNAL, fontWeight: 500 }}>points</div>
                    <div style={{ display: 'flex' }}>{line.slice('points'.length)}</div>
                  </>
                ) : (
                  line
                )}
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: 92,
            padding: `0 ${PAD}px`,
            borderTop: `1px solid ${RULE}`,
            fontSize: 22,
          }}
        >
          <div style={{ display: 'flex', color: MUTED }}>
            {`${counted} credentials counted · ${uncounted} uncounted, with reasons`}
          </div>
          <div style={{ display: 'flex', color: TYPE }}>talentprotocol.com</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Cal Sans', data: calSans, weight: 400, style: 'normal' },
        { name: 'Geist Mono', data: mono, weight: 400, style: 'normal' },
        { name: 'Geist Mono', data: monoMedium, weight: 500, style: 'normal' },
      ],
    }
  )
}
