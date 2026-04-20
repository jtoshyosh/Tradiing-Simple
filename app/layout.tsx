import './globals.css';
import type { Metadata, Viewport } from 'next';

const PRIMARY_ICON = '/31AA24C9-9277-40A3-90DA-AE0ED5E1FB74.jpg';
const ALT_ICON = '/7EBAD580-EC19-40A0-9CF6-1C80207BF90F.jpg';

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
      { url: PRIMARY_ICON, type: 'image/jpeg' },
      { url: ALT_ICON, type: 'image/jpeg' }
    ],
    apple: [
      { url: PRIMARY_ICON, type: 'image/jpeg', sizes: '180x180' }
    ],
    shortcut: [
      { url: PRIMARY_ICON, type: 'image/jpeg' }
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
