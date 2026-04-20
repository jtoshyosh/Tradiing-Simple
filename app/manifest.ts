import type { MetadataRoute } from 'next';

const PRIMARY_ICON = '/31AA24C9-9277-40A3-90DA-AE0ED5E1FB74.jpg';
const ALT_ICON = '/7EBAD580-EC19-40A0-9CF6-1C80207BF90F.jpg';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'JY Trading',
    short_name: 'JY Trading',
    description: 'Trading journal for capturing sessions, reviews, and execution quality.',
    start_url: '/',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    icons: [
      {
        src: PRIMARY_ICON,
        sizes: '192x192',
        type: 'image/jpeg'
      },
      {
        src: PRIMARY_ICON,
        sizes: '512x512',
        type: 'image/jpeg'
      },
      {
        src: PRIMARY_ICON,
        sizes: '180x180',
        type: 'image/jpeg',
        purpose: 'any'
      },
      {
        src: ALT_ICON,
        sizes: '512x512',
        type: 'image/jpeg',
        purpose: 'maskable'
      }
    ]
  };
}
