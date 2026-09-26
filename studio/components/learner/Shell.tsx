'use client';
/**
 * The learner app's frame. Signed-out pages get the landing nav or the
 * plain auth bar; signed-in pages get the top bar with streak and XP,
 * top navigation on desktop and the tab bar on phones, never both.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bolt, Flame, MarkIcon, TabIcons } from './icons';
import { useAcademy, useMe } from './context';

export function Mark({ href = '/', small = false }: { href?: string; small?: boolean }) {
  const academy = useAcademy();
  return (
    <Link className="mark" href={href} style={small ? { fontSize: 15 } : undefined}>
      <i style={small ? { width: 30, height: 30 } : undefined}><MarkIcon /></i>
      <span>{academy.name}</span>
    </Link>
  );
}

export function SkipLink() {
  return <a className="skiplink" href="#main">Skip to content</a>;
}

export function LandingNav({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="nav"><div className="wrap">
      <Mark />
      <nav className="links" aria-label="Academy">
        <a href="#how">How it works</a>
        <a href="#courses">Courses</a>
        <Link href="/verify">Verify a certificate</Link>
        {signedIn ? null : <Link className="strong" href="/signin">Sign in</Link>}
      </nav>
      {signedIn
        ? <Link className="btn sm" href="/path" style={{ marginLeft: 12 }}>Go to your path</Link>
        : <Link className="btn sm" href="/signup" style={{ marginLeft: 12 }}>Start your placement</Link>}
    </div></header>
  );
}

/** The bar on sign-in, sign-up and the first steps: the academy, and nowhere else to wander. */
export function PlainTop({ children }: { children?: React.ReactNode }) {
  return <header className="topbar"><div className="wrap"><Mark small />{children}</div></header>;
}

const PLACES = [
  { href: '/path', label: 'Path', icon: TabIcons.path },
  { href: '/explore', label: 'Explore', icon: TabIcons.explore },
  { href: '/progress', label: 'Progress', icon: TabIcons.progress },
  { href: '/me', label: 'Me', icon: TabIcons.me },
] as const;

/** Streak and XP, as the server counts them. The streak shows once there is one. */
export function Chips() {
  const { me } = useMe(false);
  if (!me) return null;
  return (
    <div className="chips">
      {me.stats.streakDays > 0 ? (
        <span className="chip streak" title="Learning streak"><Flame /><span className="visually-hidden">Streak: </span>{me.stats.streakDays}<span className="visually-hidden"> days</span></span>
      ) : null}
      <span className="chip"><Bolt />{me.stats.xp} XP</span>
    </div>
  );
}

export function AppTop({ nav = true }: { nav?: boolean }) {
  const pathname = usePathname() ?? '';
  return (
    <header className="topbar"><div className="wrap">
      <Mark href="/path" small />
      {nav ? (
        <nav className="links" aria-label="Main">
          {PLACES.map((p) => <Link key={p.href} href={p.href} aria-current={pathname.startsWith(p.href) ? 'page' : undefined}>{p.label}</Link>)}
        </nav>
      ) : null}
      <Chips />
    </div></header>
  );
}

export function Tabbar() {
  const pathname = usePathname() ?? '';
  return (
    <nav className="tabbar" aria-label="Main">
      {PLACES.map((p) => (
        <Link key={p.href} href={p.href} aria-current={pathname.startsWith(p.href) ? 'page' : undefined}>{p.icon}{p.label}</Link>
      ))}
    </nav>
  );
}

export function Footer() {
  const academy = useAcademy();
  return (
    <footer><div className="wrap">
      <span>{academy.name} is operated for you by your broker. Your learning record belongs to this academy and is never shared with another.</span>
    </div></footer>
  );
}
