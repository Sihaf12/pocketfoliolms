/**
 * The studio's icon set: one stroke style, 24px grid. Icons sit beside a
 * word; where one stands alone, its button carries the label.
 */
const PATHS = {
  book: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5',
  check: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M8 12.5l2.5 2.5L16 9.5',
  people: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M2 21a7 7 0 0 1 14 0 M16 3.5a4 4 0 0 1 0 7.5 M18.5 14.5A7 7 0 0 1 22 21',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  building: 'M4 21V5l8-3 8 3v16 M9 21v-5h6v5 M8 9h.01 M12 9h.01 M16 9h.01 M8 13h.01 M12 13h.01 M16 13h.01 M2 21h20',
  send: 'M22 2 11 13 M22 2l-7 20-4-9-9-4 20-7Z',
  glossary: 'M4 4h11a3 3 0 0 1 3 3v14H7a3 3 0 0 1-3-3V4Z M8 8h6 M8 12h6',
  back: 'M15 18l-6-6 6-6',
  next: 'M9 18l6-6-6-6',
  plus: 'M12 5v14 M5 12h14',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  pencil: 'M16 3l5 5L8 21H3v-5L16 3Z',
  lock: 'M6 11h12v10H6V11Z M8 11V7a4 4 0 0 1 8 0v4',
  copy: 'M9 9h11v11H9V9Z M5 15H4V4h11v1',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
  palette: 'M12 22a10 10 0 1 1 10-10c0 3-3 3-5 3h-1a2 2 0 0 0-1 3.7A2 2 0 0 1 12 22Z M7.5 11h.01 M10 7h.01 M15 7h.01',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M2 12h20 M12 2a15 15 0 0 1 0 20 M12 2a15 15 0 0 0 0 20',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1 M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  signout: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4 M10 17l-5-5 5-5 M5 12h12',
  arrowUp: 'M12 19V5 M5 12l7-7 7 7',
  arrowDown: 'M12 5v14 M19 12l-7 7-7-7',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, label }: { name: IconName; label?: string }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
