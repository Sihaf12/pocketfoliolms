import { CoursePage } from '@/components/pages/Course';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CoursePage courseId={id} />;
}
