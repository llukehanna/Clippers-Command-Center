import { Panel } from '@/components/ui/panel'
import { Eyebrow } from '@/components/ui/eyebrow'
import type { RecordNote } from '@/src/lib/ui/types'

export function RecordMoments({ notes }: { notes: RecordNote[] }) {
  return (
    <Panel className="h-full p-5">
      <Eyebrow>Record book</Eyebrow>
      <ul className="m-0 grid list-none gap-2.5 p-0 text-[14px]">
        {notes.map((n) => (
          <li key={n.key} className="leading-snug">{n.text}</li>
        ))}
      </ul>
    </Panel>
  )
}
