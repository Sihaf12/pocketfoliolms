/** Public certificate verification, served by Fastify. */
import { forward } from '@/lib/backend';

export const dynamic = 'force-dynamic';
export const GET = (request: Request) => forward(request, new URL(request.url).pathname);
