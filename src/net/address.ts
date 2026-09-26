/**
 * Which addresses an academy's CRM endpoint may never be: anything that
 * would let a tenant-supplied URL reach inside our own network, the
 * cloud metadata service, or this machine.
 *
 * Used twice: when an admin saves the endpoint (for an early, readable
 * refusal) and at delivery, inside the connection's own DNS lookup, so a
 * name that re-resolves to an internal address is refused at the moment
 * it would be connected to.
 */
import { isIP } from 'node:net';

const V4_BLOCKED: [number, number][] = [
  [0x00000000, 8], // this network
  [0x0a000000, 8], // private
  [0x64400000, 10], // carrier-grade NAT
  [0x7f000000, 8], // loopback
  [0xa9fe0000, 16], // link-local, including cloud metadata
  [0xac100000, 12], // private
  [0xc0000000, 24], // IETF protocol assignments
  [0xc0a80000, 16], // private
  [0xc6120000, 15], // benchmarking
  [0xe0000000, 4], // multicast
  [0xf0000000, 4], // reserved and broadcast
];

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

function blockedV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => (n >>> (32 - bits)) === (base >>> (32 - bits)));
}

function blockedV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return blockedV4(mapped[1]!);
  const first = parseInt(lower.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00 // unique local
    || (first & 0xffc0) === 0xfe80 // link-local
    || (first & 0xff00) === 0xff00; // multicast
}

/** True for any address a CRM delivery must not reach. Unparseable counts as blocked. */
export function isBlockedAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, '');
  const version = isIP(bare);
  if (version === 4) return blockedV4(bare);
  if (version === 6) return blockedV6(bare);
  return true;
}

/** A quick, DNS-free judgement of a host name, for the admin's form. */
export function isObviouslyInternalHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (isIP(h)) return isBlockedAddress(h);
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.');
}
