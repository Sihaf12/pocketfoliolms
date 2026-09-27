'use client';
/**
 * The academy this page belongs to, decided by the server from the host,
 * and the signed-in learner, read once and shared by every screen.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ApiError, call } from '@/lib/api';

export interface Academy { name: string; sub: string; googleSignIn: boolean }

export type Tier = 'learn' | 'safeguard' | 'apply' | 'specialise';
export type Scores = Record<Tier, number>;

export interface Me {
  user: { id: string; email: string; displayName: string; lifecycle: string; ibRefCode: string | null; goal: string | null; dailyMinutes: number | null };
  academy: { name: string };
  placement: { level: string; baseline: Scores } | null;
  stats: { xp: number; streakDays: number; verifiedLessons: number; totalLessons: number };
  tiers: { tier: Tier; verifiedLessons: number; totalLessons: number }[];
  recent: { lessonId: string; title: string; tier: Tier; xp: number; verifiedAt: string }[];
  certificates: { serial: string; courseTitle: string; issuedAt: string }[];
  /** Monday to Sunday of this week: whether a lesson was verified that day. */
  week?: { date: string; learned: boolean }[];
}

interface Session {
  me: Me | null;
  /** Loaded, whether or not anyone is signed in. */
  settled: boolean;
  refresh(): Promise<Me | null>;
  forget(): void;
}

const AcademyCtx = createContext<Academy>({ name: '', sub: '', googleSignIn: false });
const SessionCtx = createContext<Session | null>(null);

export const useAcademy = () => useContext(AcademyCtx);

export function LearnerProviders({ academy, children }: { academy: Academy; children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [settled, setSettled] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const next = await call<Me>('/api/v1/me');
      setMe(next);
      return next;
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) throw err;
      setMe(null);
      return null;
    } finally {
      setSettled(true);
    }
  }, []);
  const forget = useCallback(() => { setMe(null); }, []);
  return (
    <AcademyCtx.Provider value={academy}>
      <SessionCtx.Provider value={{ me, settled, refresh, forget }}>{children}</SessionCtx.Provider>
    </AcademyCtx.Provider>
  );
}

/** Where a learner belongs, from how far they have got. */
export function homeFor(lifecycle: string): string {
  if (lifecycle === 'registered') return '/onboarding';
  if (lifecycle === 'onboarded') return '/placement';
  return '/path';
}

/**
 * The signed-in learner. With `required`, someone signed out is sent to
 * sign in and brought back here after.
 */
export function useMe(required: boolean): Session {
  const session = useContext(SessionCtx);
  if (!session) throw new Error('useMe outside LearnerProviders');
  const router = useRouter();
  const pathname = usePathname();
  const { me, settled, refresh } = session;
  useEffect(() => {
    if (!me) void refresh().then((m) => {
      if (!m && required) router.replace(`/signin?next=${encodeURIComponent(pathname ?? '/path')}`);
    });
    // Once per page: the session is shared, so later pages reuse it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { ...session, settled: settled || !!me };
}
