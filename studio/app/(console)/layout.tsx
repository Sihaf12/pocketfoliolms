import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/StudioShell';

export const metadata: Metadata = { title: 'Platform console' };

/** The console wears the default academy's tokens: it is the platform's, not a broker's. */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <ConsoleShell>{children}</ConsoleShell>;
}
