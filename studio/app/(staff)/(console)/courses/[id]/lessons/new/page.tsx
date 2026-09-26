import { NewLessonPage } from '@/components/pages/Lesson';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NewLessonPage courseId={id} />;
}
