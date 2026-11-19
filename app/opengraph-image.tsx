import { C, OG_SIZE, renderCard } from './_og/card'

export const alt = 'Clippers Command Center: live Clippers scores, box scores, trends and verified insights'
export const size = OG_SIZE
export const contentType = 'image/png'

export default async function Image() {
  return renderCard(
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 84, fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1.02 }}>Clippers Command Center</div>
      <div style={{ marginTop: 22, fontSize: 32, color: C.mute, lineHeight: 1.35, maxWidth: 900 }}>
        Live scores, box scores, trends and verified insights for every Clippers game.
      </div>
    </div>,
    'LA Clippers',
  )
}
