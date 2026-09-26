/** The learner page at /, served by Fastify with the academy's brand. */
import { forward } from '@/lib/backend';

export const dynamic = 'force-dynamic';
export const GET = (request: Request) => forward(request, '/');
