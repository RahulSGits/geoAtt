'use client'

import { ThemeProvider } from '@/components/ThemeProvider'
import { ToastProvider } from '@/components/Toast'

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ToastProvider>{children}</ToastProvider>
    </ThemeProvider>
  )
}
