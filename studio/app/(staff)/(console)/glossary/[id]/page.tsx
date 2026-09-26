import { TermPage } from '@/components/pages/Glossary';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TermPage termId={id} />;
}
