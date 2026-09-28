import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** LAC mark centered on the app's navy ground; shared by icon and apple-icon. */
export async function iconArt(size: number) {
  const logo = await readFile(path.join(process.cwd(), 'public/teams/lac.png'))
  const src = `data:image/png;base64,${logo.toString('base64')}`
  const mark = Math.round(size * 0.68)
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(circle at 30% 20%, #16325a, #060a12 70%)',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} width={mark} height={mark} alt="" />
    </div>
  )
}
