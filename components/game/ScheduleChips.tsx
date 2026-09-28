import { Chip } from '@/components/ui/chip'
import type { ScheduleAnnotation } from '@/src/lib/ui/schedule'

/** B2B / rest / home-stand chips for one game. */
export function ScheduleChips({ annotation, showStand = true }: { annotation: ScheduleAnnotation; showStand?: boolean }) {
  const { b2b, restDays, stand } = annotation
  return (
    <>
      {b2b && (
        <Chip tone="warn" title="Second night of a back-to-back">
          B2B
        </Chip>
      )}
      {!b2b && restDays != null && restDays >= 2 && <Chip title={`${restDays} days off before this game`}>Rest {restDays}</Chip>}
      {showStand && stand && (
        <Chip tone="blue" title={`${stand.kind === 'home' ? 'Home stand' : 'Road trip'}: game ${stand.index} of ${stand.length}`}>
          {stand.kind === 'home' ? 'Home stand' : 'Road trip'} {stand.index}/{stand.length}
        </Chip>
      )}
    </>
  )
}
