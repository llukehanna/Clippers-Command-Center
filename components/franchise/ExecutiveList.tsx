import { Panel } from '@/components/ui/panel'
import { Chip } from '@/components/ui/chip'
import { InitialsDisc, PersonName } from './bits'
import { isCurrentTerm, type ExecutiveGroup } from '@/src/lib/franchise/tenures'

const year = (d: string | null) => (d ? d.slice(0, 4) : '—')

/** General managers and presidents with their dates, grouped by title. "present" only for the group's newest open term. */
export function ExecutiveList({ groups }: { groups: ExecutiveGroup[] }) {
  return (
    <Panel className="py-0.5">
      {groups.map((g) => (
        <div key={g.title} className="px-4 pb-3 pt-4 sm:px-5 [&+&]:border-t [&+&]:border-line">
          <p className="label-mono m-0 mb-2">{g.title}</p>
          {g.terms.map((t) => (
            <div key={`${t.person.person_key}-${t.start_date}`} className="row-hover -mx-2.5 grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 rounded-[12px] px-2.5 py-2">
              <InitialsDisc name={t.person.name} size={32} />
              <PersonName person={t.person} className="truncate text-[14.5px] font-medium tracking-[-0.01em]" />
              <span className="whitespace-nowrap text-right font-mono text-[11.5px] text-mute">
                {year(t.start_date)} –{' '}
                {t.end_date ? (
                  year(t.end_date)
                ) : isCurrentTerm(t, g.terms) ? (
                  <Chip tone="blue" className="align-[1px]">
                    present
                  </Chip>
                ) : (
                  '—'
                )}
              </span>
            </div>
          ))}
        </div>
      ))}
    </Panel>
  )
}
