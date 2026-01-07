import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { ThemeProvider } from '@/components/theme-provider'
import { Navigation } from '@/components/navigation'
import { SocketProvider } from '@/components/socket-provider'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'StackMemory Dashboard',
  description: 'Real-time monitoring and management for StackMemory',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <SocketProvider>
            <div className="flex h-screen">
              <Navigation />
              <main className="flex-1 overflow-y-auto bg-background">
                {children}
              </main>
            </div>
          </SocketProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}