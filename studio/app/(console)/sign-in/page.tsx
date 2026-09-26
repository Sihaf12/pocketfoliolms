import { Suspense } from 'react';
import { SignIn } from '@/components/pages/SignIn';

export default function Page() {
  return <Suspense><SignIn /></Suspense>;
}
