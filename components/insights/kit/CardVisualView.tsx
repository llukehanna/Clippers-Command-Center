import type { CardVisual } from '@/src/lib/insights/visual'
import { BestBars } from './visuals/BestBars'
import { Company } from './visuals/Company'
import { Delta } from './visuals/Delta'
import { GapLine } from './visuals/GapLine'
import { MarginSpark } from './visuals/MarginSpark'
import { MilestoneBar } from './visuals/MilestoneBar'
import { RankTrack } from './visuals/RankTrack'
import { StreakStrip } from './visuals/StreakStrip'
import { TeamYoyDeltas } from './visuals/TeamYoyDeltas'

/**
 * Draws a card's visual. Each visual's root is role="img" with the visual's
 * aria text; a visual whose inputs can't be drawn renders nothing.
 */
export function CardVisualView({ visual, size }: { visual: CardVisual; size: 'hero' | 'standard' }) {
  switch (visual.kind) {
    case 'gap':
      return <GapLine visual={visual} size={size} />
    case 'best':
      return <BestBars visual={visual} />
    case 'company':
      return <Company visual={visual} />
    case 'team_yoy':
      return <TeamYoyDeltas visual={visual} />
    case 'evidence': {
      const e = visual.evidence
      switch (e.type) {
        case 'rank_track':
          return <RankTrack evidence={e} aria={visual.aria} />
        case 'streak_strip':
          return <StreakStrip evidence={e} aria={visual.aria} />
        case 'delta':
          return <Delta evidence={e} aria={visual.aria} />
        case 'milestone_progress':
          return <MilestoneBar evidence={e} aria={visual.aria} />
        case 'margin_spark':
          return <MarginSpark evidence={e} aria={visual.aria} />
        default:
          return null
      }
    }
    default:
      return null
  }
}
