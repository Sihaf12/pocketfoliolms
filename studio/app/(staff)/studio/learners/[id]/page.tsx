import { LearnerPage } from '@/components/pages/Learners';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LearnerPage learnerId={id} />;
}
