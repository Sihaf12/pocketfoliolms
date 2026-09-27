/** The design's icons: the academy mark and the few glyphs the learner app uses. */
export const MarkIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 12l9 4 9-4" /><path d="M3 17l9 4 9-4" /></svg>
);
export const Bolt = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></svg>;
export const Flame = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c.9 3.6 5.5 5.9 5.5 11.2A5.5 5.5 0 016.5 13.4c0-2.3 1.2-4 2.4-5 .2 2.2 1.2 3.3 2.5 3.8C10.8 8.6 11 5.3 12 2z" /></svg>
);
export const Tick = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L19 7" /></svg>;
export const Play = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l12 7-12 7z" /></svg>;
export const Chevron = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--ink-soft)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
);
export const Close = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>;
/** Google's G, in Google's own colours, as its sign-in guidance asks. */
export const GoogleG = () => (
  <svg viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);
export const STAR_PATH = 'M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z';

export const TabIcons = {
  path: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3L3 6v15l6-3 6 3 6-3V3l-6 3-6-3z" /><path d="M9 3v15M15 6v15" /></svg>,
  explore: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></svg>,
  progress: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></svg>,
  me: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></svg>,
};
