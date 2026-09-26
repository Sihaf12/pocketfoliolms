import type { Metadata, Viewport } from 'next';
import { Nunito_Sans, Poppins } from 'next/font/google';
import './globals.css';

// The skill's two families: Poppins for display, Nunito Sans for reading.
const poppins = Poppins({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-poppins', display: 'swap' });
const nunito = Nunito_Sans({ subsets: ['latin'], weight: ['400', '600', '700'], variable: '--font-nunito', display: 'swap' });

export const metadata: Metadata = { title: 'Studio', robots: { index: false, follow: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${poppins.variable} ${nunito.variable}`}>
      <body>{children}</body>
    </html>
  );
}
