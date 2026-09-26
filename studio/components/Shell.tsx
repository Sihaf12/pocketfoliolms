'use client';
/**
 * Navigation: a tab bar on phones, a top bar on desktop, never both.
 * Which places appear depends on the person's roles; the API refuses the
 * rest anyway, so this only keeps people out of dead ends.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from './Icon';
import { useWorkspace, type Workspace } from './Workspace';

export interface Place {
  path: string;
  label: string;
  icon: IconName;
  /** Other paths that belong to this place, for the current-page mark. */
  also?: string[];
  /** In the phone's tab bar, rather than under More. */
  tab?: boolean;
}

const CONTENT_CHILDREN = ['/courses', '/lessons', '/versions', '/glossary'];

export function placesFor(ws: Workspace): Place[] {
  if (ws.kind === 'studio') {
    return [
      { path: '/', label: 'Content', icon: 'book', also: CONTENT_CHILDREN, tab: true },
      { path: '/review', label: 'Review', icon: 'check', tab: true },
      ...(ws.isAdmin ? [
        { path: '/learners', label: 'Learners', icon: 'people', tab: true } as Place,
        { path: '/catalogue', label: 'Catalogue', icon: 'list' } as Place,
        { path: '/team', label: 'Team', icon: 'shield' } as Place,
        { path: '/settings', label: 'Settings', icon: 'palette' } as Place,
      ] : []),
    ];
  }
  const owner = ws.me?.roles.includes('platform_owner') ?? false;
  return [
    { path: '/', label: 'Content', icon: 'book', also: CONTENT_CHILDREN.filter((p) => p !== '/glossary'), tab: true },
    { path: '/review', label: 'Review', icon: 'check', tab: true },
    { path: '/glossary', label: 'Glossary', icon: 'glossary' },
    ...(owner ? [
      { path: '/academies', label: 'Academies', icon: 'building', tab: true } as Place,
      { path: '/staff', label: 'Staff', icon: 'shield' } as Place,
      { path: '/deliveries', label: 'Deliveries', icon: 'send' } as Place,
    ] : []),
  ];
}

function isCurrent(ws: Workspace, pathname: string, place: Place): boolean {
  const at = (p: string) => {
    const full = ws.href(p);
    return p === '/' ? pathname === full || pathname === `${full}/` : pathname === full || pathname.startsWith(`${full}/`);
  };
  return at(place.path) || (place.also ?? []).some(at);
}

export function Shell({ bare, children }: { bare: boolean; children: React.ReactNode }) {
  const ws = useWorkspace();
  const pathname = usePathname() ?? '/';
  const home = ws.href('/');
  const subtitle = ws.kind === 'studio' ? 'Studio' : 'Console';

  if (bare) {
    return <main id="main" className="page bare">{children}</main>;
  }

  const places = placesFor(ws);
  const tabs = places.filter((p) => p.tab);
  const moreCurrent = !places.some((p) => isCurrent(ws, pathname, p) && p.tab);

  return (
    <>
      <a className="btn primary skip" href="#main">Skip to content</a>
      <header className="topbar">
        <Link className="mark" href={home}><b>{ws.place}</b><span>{subtitle}</span></Link>
        <nav aria-label="Main">
          {places.map((p) => (
            <Link key={p.path} href={ws.href(p.path)} aria-current={isCurrent(ws, pathname, p) ? 'page' : undefined}>{p.label}</Link>
          ))}
        </nav>
        <div className="who">
          <span>{ws.me?.displayName}</span>
          <button className="btn ghost" type="button" onClick={() => void ws.signOut()}>Sign out</button>
        </div>
      </header>
      <header className="phonebar">
        <Link className="mark" href={home}><b>{ws.place}</b><span>{subtitle}</span></Link>
      </header>
      <main id="main" className="page">{children}</main>
      <nav className="tabbar" aria-label="Main">
        {tabs.map((p) => (
          <Link key={p.path} href={ws.href(p.path)} aria-current={isCurrent(ws, pathname, p) ? 'page' : undefined}>
            <Icon name={p.icon} />{p.label}
          </Link>
        ))}
        <Link href={ws.href('/more')} aria-current={moreCurrent ? 'page' : undefined}><Icon name="more" />More</Link>
      </nav>
    </>
  );
}

/** The phone's More page: every place not in the tab bar, and signing out. */
export function MorePage() {
  const ws = useWorkspace();
  const rest = placesFor(ws).filter((p) => !p.tab);
  return (
    <>
      <div className="head"><div><h1>More</h1><p>Signed in as {ws.me?.displayName}, {ws.me?.email}.</p></div></div>
      <nav aria-label="More places">
        <ul className="list">
          {rest.map((p) => (
            <li key={p.path}>
              <Link className="item" href={ws.href(p.path)}>
                <Icon name={p.icon} /><span className="grow"><span className="title">{p.label}</span></span><Icon name="next" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="actions">
        <button className="btn" type="button" onClick={() => void ws.signOut()}><Icon name="signout" />Sign out</button>
      </div>
    </>
  );
}
