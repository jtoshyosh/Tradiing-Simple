import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'JY Trading Journal v0.9 Connected',
  description: 'Connected trading journal powered by Next.js + Supabase.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
