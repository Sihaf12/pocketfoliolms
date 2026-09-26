import 'server-only';
import { headers } from 'next/headers';
import type { From } from './backend';

/** Who is asking for this page, as the edge server recorded it. */
export async function requestFrom(): Promise<From> {
  const h = await headers();
  return { host: h.get('host') ?? '', ip: h.get('x-forwarded-for') ?? '', headers: h };
}
