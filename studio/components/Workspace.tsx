'use client';
/**
 * The two surfaces share every content screen. What differs between them
 * is here: where pages live, where the API is, and who is signed in.
 *
 *   studio   an academy's host, pages under /studio, API at /api/studio
 *   console  the console's host, pages at its root (home is /content), API at /api/console
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ApiError, call } from '@/lib/api';

export type Kind = 'studio' | 'console';
export type Duty = 'author' | 'reviewer' | 'compliance';

export interface Me {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
}

export interface Workspace {
  kind: Kind;
  /** The academy's name in the studio; "Platform console" in the console. */
  place: string;
  me: Me | null;
  reviewSignoffs: number;
  href(path: string): string;
  api(path: string): string;
  content(path: string): string;
  has(duty: Duty): boolean;
  isAdmin: boolean;
  signOut(): Promise<void>;
  say(message: string): void;
  /** Sends the person to sign in if an API call found them signed out. */
  handle(err: unknown): void;
}

const Ctx = createContext<Workspace | null>(null);

export function useWorkspace(): Workspace {
  const ws = useContext(Ctx);
  if (!ws) throw new Error('useWorkspace outside a workspace');
  return ws;
}

const DUTY: Record<string, Duty | null> = {
  author: 'author', reviewer: 'reviewer', compliance: 'compliance', tenant_admin: null,
  platform_author: 'author', platform_reviewer: 'reviewer', platform_compliance: 'compliance', platform_owner: null,
};

interface MeResponse {
  user?: Me;
  staff?: Omit<Me, 'roles'> & { role: string };
  reviewSignoffs?: number;
}

export function WorkspaceProvider({ kind, place, publicPaths, children }: {
  kind: Kind;
  place: string;
  /** Pages anyone may open: sign-in and invitations. */
  publicPaths: string[];
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const isPublic = publicPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const [me, setMe] = useState<Me | null>(null);
  const [signoffs, setSignoffs] = useState(kind === 'console' ? 3 : 2);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The console's home is /content: its host's / is only a redirect there.
  const href = useCallback((path: string) => (kind === 'studio' ? `/studio${path === '/' ? '' : path}` : path === '/' ? '/content' : path), [kind]);
  const api = useCallback((path: string) => `/api/${kind}${path}`, [kind]);
  const content = useCallback((path: string) => (kind === 'studio' ? `/api/studio${path}` : `/api/console/content${path}`), [kind]);

  const toSignIn = useCallback(() => {
    router.replace(`${href('/sign-in')}?next=${encodeURIComponent(pathname)}`);
  }, [router, href, pathname]);

  useEffect(() => {
    if (isPublic) return;
    let live = true;
    call<MeResponse>(api('/me')).then((r) => {
      if (!live) return;
      if (r.user) setMe(r.user);
      if (r.staff) setMe({ id: r.staff.id, email: r.staff.email, displayName: r.staff.displayName, roles: [r.staff.role] });
      if (r.reviewSignoffs) setSignoffs(r.reviewSignoffs);
    }).catch((err: unknown) => {
      if (live && err instanceof ApiError && err.status === 401) toSignIn();
    });
    return () => { live = false; };
  }, [isPublic, api, toSignIn]);

  const say = useCallback((text: string) => {
    setMessage(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 3200);
  }, []);

  const ws = useMemo<Workspace>(() => ({
    kind, place, me, reviewSignoffs: signoffs, href, api, content,
    has: (duty) => (me?.roles ?? []).some((r) => DUTY[r] === duty),
    isAdmin: (me?.roles ?? []).some((r) => r === 'tenant_admin' || r === 'platform_owner'),
    signOut: async () => {
      await call(api('/auth/logout'), { method: 'POST' }).catch(() => undefined);
      setMe(null);
      router.replace(href('/sign-in'));
    },
    say,
    handle: (err) => {
      if (err instanceof ApiError && err.status === 401) toSignIn();
    },
  }), [kind, place, me, signoffs, href, api, content, router, say, toSignIn]);

  return (
    <Ctx.Provider value={ws}>
      {isPublic || me ? children : <main className="page" aria-busy="true" />}
      <div aria-live="polite" role="status">{message ? <div className="toast">{message}</div> : null}</div>
    </Ctx.Provider>
  );
}
