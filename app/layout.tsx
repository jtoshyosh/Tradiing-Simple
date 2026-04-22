import './globals.css';
import type { Metadata, Viewport } from 'next';

const PRIMARY_ICON = '/brand/JY_Trading_Logo_Black_Background.png';
const ALT_ICON = '/brand/JY_Trading_Logo_only.jpeg';

export const metadata: Metadata = {
  title: 'JY Trading',
  description: 'Trading journal for capturing sessions, reviews, and execution quality.',
  applicationName: 'JY Trading',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'JY Trading',
    statusBarStyle: 'black-translucent'
  },
  icons: {
    icon: [
      { url: PRIMARY_ICON, type: 'image/png' },
      { url: ALT_ICON, type: 'image/jpeg' }
    ],
    apple: [
      { url: PRIMARY_ICON, type: 'image/png', sizes: '180x180' }
    ],
    shortcut: [
      { url: PRIMARY_ICON, type: 'image/png' }
    ]
  }
};

export const viewport: Viewport = {
  themeColor: '#000000'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
