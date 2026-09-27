/**
 * Which pages a host gets. The console's host serves the console, at its
 * root; every other host is an academy, with the learner app at / and its
 * own paths, the studio under /studio and certificate checks under /verify. A path that
 * belongs to the other surface is a plain 404 on this one. The Google
 * callback host (AUTH_CALLBACK_HOST) serves only its API route, so it has
 * no pages at all. The API enforces the same split again; this keeps the
 * pages apart.
 *
 * No rewrites: Next.js would build them on the address it listens on,
 * not the host the browser asked for, and send them out as new requests.
 */
import { NextResponse, type NextRequest } from 'next/server';

/** An academy's pages: the learner app, the studio, and certificate checks. */
const ACADEMY_PATHS = [
  /^\/$/, /^\/studio(\/|$)/, /^\/verify(\/|$)/,
  /^\/(signup|signin|onboarding|placement|start|path|explore|progress|me)$/, /^\/learn\//,
];

function hostOf(request: NextRequest): string {
  return (request.headers.get('host') ?? '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

const notFound = () => new NextResponse('Not found.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });

export function proxy(request: NextRequest) {
  const consoleHost = (process.env.CONSOLE_HOST ?? '').toLowerCase();
  const callbackHost = (process.env.AUTH_CALLBACK_HOST ?? '').trim().toLowerCase().replace(/:\d+$/, '');
  const path = request.nextUrl.pathname;
  const academyPath = ACADEMY_PATHS.some((p) => p.test(path));

  if (callbackHost && hostOf(request) === callbackHost) return notFound();

  if (consoleHost && hostOf(request) === consoleHost) {
    // Built on the host the browser asked for, not the address Next.js listens on.
    if (path === '/') {
      const proto = process.env.PUBLIC_PROTO === 'http' ? 'http' : 'https';
      return NextResponse.redirect(`${proto}://${request.headers.get('host')}/content`, 307);
    }
    return academyPath ? notFound() : NextResponse.next();
  }
  return academyPath ? NextResponse.next() : notFound();
}

export const config = {
  matcher: ['/((?!api/|_next/|favicon.ico).*)'],
};
