import { Suspense } from 'react';
import { SignIn } from '@/components/learner/pages/Auth';

export default function Page() {
  return <Suspense><SignIn /></Suspense>;
}
