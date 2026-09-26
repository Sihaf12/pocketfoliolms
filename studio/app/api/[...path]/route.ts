/**
 * Every /api request, forwarded to Fastify unchanged apart from the
 * signed forwarding headers. The API decides everything: tenancy,
 * sessions, roles, the same-origin rule. This route only carries.
 */
import { forward } from '@/lib/backend';

const handler = (request: Request) => forward(request, new URL(request.url).pathname);

export const dynamic = 'force-dynamic';
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE, handler as HEAD };
