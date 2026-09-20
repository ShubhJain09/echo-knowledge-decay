import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Echo — Knowledge that keeps up',
  description: 'Review new evidence, keep organizational knowledge current, and preserve the history behind every decision.',
  icons: { icon: '/favicon.svg' },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
