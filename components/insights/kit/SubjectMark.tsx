import { PlayerAvatar } from '@/components/ui/player-avatar'
import { TeamLogo } from '@/components/ui/team-mark'
import type { CardSubject } from '@/src/lib/insights/card'

/** A card's who: his headshot (initials fallback) or the Clippers logo. */
export function SubjectMark({ subject, size }: { subject: CardSubject; size: number }) {
  if (subject.kind === 'team') return <TeamLogo abbr={subject.abbr} size="sm" />
  return <PlayerAvatar name={subject.name} nbaPlayerId={subject.nba_person_id} size={size} />
}
