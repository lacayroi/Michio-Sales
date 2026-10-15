import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Michio Sales Hub', template: '%s · Michio Sales Hub' },
  description: 'Quản lý, chia việc và chăm sóc khách sỉ — Michio Việt Nam',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Michio Sales', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#00A651',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
