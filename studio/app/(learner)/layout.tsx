import type { Metadata, Viewport } from 'next';
import { backendJson } from '@/lib/backend';
import { Nunito_Sans, Poppins } from 'next/font/google';
import { requestFrom } from '@/lib/request';
import { Theme, isDark } from '@/lib/theme';
import { LearnerProviders } from '@/components/learner/context';
import './learner.css';

// The skill's two families: Poppins for display, Nunito Sans for reading.
const poppins = Poppins({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-poppins', display: 'swap' });
const nunito = Nunito_Sans({ subsets: ['latin'], weight: ['400', '600', '700'], variable: '--font-nunito', display: 'swap' });

interface Academy { name: string; sub: string; tokens: Record<string, string> }

async function academy(): Promise<Academy | null> {
  return (await backendJson<Academy>('/api/v1/academy', await requestFrom())).body;
}

export async function generateMetadata(): Promise<Metadata> {
  const a = await academy();
  return { title: a?.name ?? 'Academy' };
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

/** The learner app, in the academy's own tokens, decided on the server from the host. */
export default async function LearnerLayout({ children }: { children: React.ReactNode }) {
  const a = await academy();
  return (
    <html lang="en" className={`${poppins.variable} ${nunito.variable}`} data-scheme={a && isDark(a.tokens) ? 'dark' : 'light'}>
      <body>
        {a ? <Theme tokens={a.tokens} /> : null}
        {a ? <LearnerProviders academy={{ name: a.name, sub: a.sub }}>{children}</LearnerProviders> : <main><p>No academy answers at this address.</p></main>}
      </body>
    </html>
  );
}
