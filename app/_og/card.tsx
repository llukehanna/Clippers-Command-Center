import * as React from 'react'
import { ImageResponse } from 'next/og'
import { SITE_URL } from '@/src/lib/ics'

/** Link-preview images (iMessage, Slack, X): shared size, fonts, assets and frame. */
export const OG_SIZE = { width: 1200, height: 630 }

const TEAM_LOGOS = new Set([
  'atl', 'bkn', 'bos', 'cha', 'chi', 'cle', 'dal', 'den', 'det', 'gsw', 'hou', 'ind', 'lac', 'lal', 'mem',
  'mia', 'mil', 'min', 'nop', 'nyk', 'okc', 'orl', 'phi', 'phx', 'por', 'sac', 'sas', 'tor', 'uta', 'was',
])

/**
 * A file from /public. Read from disk when building; at request time on the
 * Worker there is no filesystem, so fetch it from the site instead.
 */
async function asset(rel: string): Promise<ArrayBuffer> {
  try {
    const { readFile } = await import('node:fs/promises')
    const path = await import('node:path')
    const buf = await readFile(path.join(process.cwd(), 'public', rel))
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  } catch {
    const res = await fetch(new URL(`/${rel}`, SITE_URL))
    if (!res.ok) throw new Error(`og asset ${rel}: ${res.status}`)
    return res.arrayBuffer()
  }
}

const toDataUrl = (buf: ArrayBuffer) => `data:image/png;base64,${Buffer.from(buf).toString('base64')}`

/** Team logo as a data URL, or null when there is no logo (old-era tricodes). */
export async function logo(abbr: string | null | undefined): Promise<string | null> {
  const slug = (abbr ?? '').toLowerCase()
  if (!TEAM_LOGOS.has(slug)) return null
  try {
    return toDataUrl(await asset(`teams/${slug}.png`))
  } catch {
    return null
  }
}

export const C = {
  text: '#e8edf6',
  mute: '#8d98ae',
  dim: '#6f7b94',
  pacific: '#418fde',
  pos: '#4cc38a',
  neg: '#f0677a',
}

export function Logo({ src, abbr, size }: { src: string | null; abbr: string; size: number }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} width={size} height={size} alt="" />
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size,
        border: '2px solid rgba(150,178,230,0.25)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.3,
        color: C.mute,
      }}
    >
      {abbr}
    </div>
  )
}

/** Dark navy frame with the app's light field, brand row and domain. */
export async function renderCard(children: React.ReactNode, eyebrow: string) {
  const [regular, semibold, crest] = await Promise.all([
    asset('fonts/Geist-Regular.ttf'),
    asset('fonts/Geist-SemiBold.ttf'),
    logo('LAC'),
  ])
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: '56px 72px',
          color: C.text,
          fontFamily: 'Geist',
          backgroundColor: '#060a12',
          backgroundImage: [
            'radial-gradient(circle at 8% 0%, rgba(65,143,222,0.42), transparent 46%)',
            'radial-gradient(circle at 96% 8%, rgba(200,16,46,0.26), transparent 40%)',
            'radial-gradient(circle at 30% 120%, rgba(20,60,120,0.7), transparent 55%)',
          ].join(', '),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {crest && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={crest} width={48} height={48} alt="" />
          )}
          <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.01em' }}>Command Center</div>
          <div style={{ marginLeft: 'auto', fontSize: 20, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.mute }}>{eyebrow}</div>
        </div>
        <div style={{ display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'center' }}>{children}</div>
        <div style={{ display: 'flex', fontSize: 20, color: C.dim, letterSpacing: '0.04em' }}>clippers.lukeghanna.com</div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: 'Geist', data: regular, weight: 400, style: 'normal' },
        { name: 'Geist', data: semibold, weight: 600, style: 'normal' },
      ],
    },
  )
}
