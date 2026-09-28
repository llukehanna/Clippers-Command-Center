import { ListPageSkeleton } from '@/components/shell/PageSkeleton'

export default function Loading() {
  return <ListPageSkeleton actions={false} rows={7} />
}
