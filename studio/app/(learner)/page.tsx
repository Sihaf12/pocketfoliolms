import { backendJson } from '@/lib/backend';
import { requestFrom } from '@/lib/request';
import { Landing, type CatalogueCourse } from '@/components/learner/pages/Landing';

export default async function Page() {
  const { body } = await backendJson<{ courses: CatalogueCourse[] }>('/api/v1/catalogue', await requestFrom());
  return <Landing courses={body?.courses ?? []} />;
}
