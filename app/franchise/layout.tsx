import { PageHeader } from '@/components/shell/PageHeader'
import { FranchiseTabs } from '@/components/franchise/FranchiseTabs'

/** Shared by every Franchise tab (and the trade pages, which keep Moves active). */
export default function FranchiseLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="page">
      <div className="enter">
        <PageHeader title="Franchise" subtitle="Every draft pick, trade and signing since 1970" />
      </div>
      <FranchiseTabs />
      {children}
    </div>
  )
}
