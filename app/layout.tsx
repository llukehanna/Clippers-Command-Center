import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
// TopNav is created in Phase 10 Plan 02 — import will be uncommented then
// import { TopNav } from '@/components/nav/TopNav'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Clippers Command Center',
  description: 'Live Clippers analytics dashboard',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} font-sans antialiased bg-background text-foreground min-w-[1024px]`}
      >
        {/* <TopNav /> — uncomment after Plan 02 */}
        <main className="pt-14">
          {children}
        </main>
      </body>
    </html>
  )
}
