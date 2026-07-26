import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import Providers from './providers'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: {
    default: 'FinAtt — Attendance & Workforce Platform',
    template: '%s · FinAtt',
  },
  description:
    'Face-verified, geofenced attendance with a full shift engine, leave workflow and live analytics.',
  // Security headers live in next.config.ts — as meta tags they would be inert.
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zoom is left enabled; capping it at 1 would fail WCAG 1.4.4.
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f7fb' },
    { media: '(prefers-color-scheme: dark)', color: '#070912' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      // Opts route transitions out of the global `scroll-behavior: smooth`, so
      // navigating between sections jumps to the top instead of gliding there.
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      {/*
        Browser extensions (password managers, writing assistants, ad blockers)
        stamp attributes like `bis_register` onto <body> before React hydrates,
        which React then reports as a server/client attribute mismatch. The
        markup we render is identical on both sides, so the warning is noise
        from the visitor's browser rather than a real divergence. Scoped to this
        one element: a genuine mismatch in the tree below still surfaces.
      */}
      <body suppressHydrationWarning>
        <div className="aurora" aria-hidden />
        <div className="grid-overlay" aria-hidden />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
