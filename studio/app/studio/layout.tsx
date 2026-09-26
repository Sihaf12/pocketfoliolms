import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { backendJson } from '@/lib/backend';
import { requestFrom } from '@/lib/request';
import { Theme } from '@/lib/theme';
import { StudioShell } from '@/components/StudioShell';

interface Academy { name: string; sub: string; tokens: Record<string, string> }

export async function generateMetadata(): Promise<Metadata> {
  const { body } = await backendJson<Academy>('/api/studio/academy', await requestFrom());
  return { title: body ? `${body.name} studio` : 'Studio' };
}

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const { status, body } = await backendJson<Academy>('/api/studio/academy', await requestFrom());
  if (status === 404 || !body) notFound();
  return (
    <>
      <Theme tokens={body.tokens} />
      <StudioShell academy={body.name}>{children}</StudioShell>
    </>
  );
}
