import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { TopBar } from '@/components/shell/TopBar'
import { CommandPalette } from '@/components/shell/CommandPalette'

const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
  display: 'swap',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Clippers Command Center',
    template: '%s · Clippers Command Center',
  },
  description: 'Live Clippers analytics — scores, box scores, trends, and verified insights.',
  applicationName: 'Clippers Command Center',
  appleWebApp: {
    capable: true,
    title: 'CCC',
    statusBarStyle: 'black-translucent',
  },
}

export const viewport: Viewport = {
  themeColor: '#060A12',
  colorScheme: 'dark',
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`dark ${geist.variable} ${geistMono.variable}`}>
      <body>
        <TopBar />
        <main>{children}</main>
        <CommandPalette />
      </body>
    </html>
  )
}
