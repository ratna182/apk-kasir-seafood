import type { Metadata, Viewport } from 'next'
import { Inter, Fraunces } from 'next/font/google'
import './globals.css'
import { ToastProvider } from '@/components/Toast'
import { DEFAULT_BRANCH_NAME } from '@/lib/branch-config'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-fraunces',
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#EAE7DE',
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: `Kasir ${DEFAULT_BRANCH_NAME}`,
  description: `Aplikasi kasir untuk ${DEFAULT_BRANCH_NAME}`,
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Kasir VJ',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="id" className={`${inter.variable} ${fraunces.variable}`} style={{ WebkitTapHighlightColor: 'transparent' }}>
      <body>
        <ToastProvider>
          {children}
        </ToastProvider>
      </body>
    </html>
  )
}
