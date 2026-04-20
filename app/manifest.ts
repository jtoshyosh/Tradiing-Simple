import type { MetadataRoute } from 'next';

const PRIMARY_ICON = '/brand/JY_Trading_Logo_only.jpeg';
const ALT_ICON = '/brand/JY_Trading_Logo_Black_Background.png';

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
        sizes: '180x180',
        type: 'image/jpeg'
      },
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
        src: ALT_ICON,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable'
      }
    ]
  };
}
