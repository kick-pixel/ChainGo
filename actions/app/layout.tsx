import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'ChainGo Actions API',
  description: 'Solana Actions API for ChainGo',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
