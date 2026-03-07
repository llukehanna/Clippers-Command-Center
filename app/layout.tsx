import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { TopNav } from '@/components/nav/TopNav'

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
        <TopNav />
        <main className="pt-14">
          {children}
        </main>
      </body>
    </html>
  )
}
