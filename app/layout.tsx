import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'JY Trading Journal',
  description: 'Trading journal for capturing sessions, reviews, and execution quality.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
