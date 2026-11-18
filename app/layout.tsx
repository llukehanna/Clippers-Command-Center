import type { Metadata, Viewport } from 'next'
import { ViewTransition } from 'react'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { SITE_URL } from '@/src/lib/ics'
import { TopBar } from '@/components/shell/TopBar'
import { CommandPalette } from '@/components/shell/CommandPalette'
import { GlassPointer } from '@/components/shell/GlassPointer'
import { MobileTabBar } from '@/components/shell/MobileTabBar'

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
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Clippers Command Center',
    template: '%s · Clippers Command Center',
  },
  description: 'Live Clippers analytics — scores, box scores, trends, and verified insights.',
  applicationName: 'Clippers Command Center',
  openGraph: {
    type: 'website',
    siteName: 'Clippers Command Center',
    locale: 'en_US',
  },
  twitter: { card: 'summary_large_image' },
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
        <ViewTransition default="page">
          <main>{children}</main>
        </ViewTransition>
        <MobileTabBar />
        <CommandPalette />
        <GlassPointer />
      </body>
    </html>
  )
}
