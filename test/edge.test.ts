/**
 * The front end's edge: whose address a request carries into Next.js,
 * with and without the reverse proxy in front.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admit, isHealthCheck, type EdgeRequest } from '../src/studio/edge.js';

const SECRET = 'caddy-and-the-edge-share-this';
const request = (headers: EdgeRequest['headers'], remoteAddress = '172.18.0.5'): EdgeRequest => ({ headers, socket: { remoteAddress } });

test('with nothing in front, a client\'s forwarded headers are dropped and the socket decides', () => {
  const req = request({ 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '6.6.6.6', forwarded: 'for=6.6.6.6', 'x-forwarded-host': 'evil.test' }, '203.0.113.9');
  assert.equal(admit(req, SECRET), true);
  assert.deepEqual(req.headers, { 'x-forwarded-for': '203.0.113.9' });
});

test('through the proxy, with the secret, the proxy\'s X-Forwarded-For names the client and the secret goes no further', () => {
  const req = request({ 'x-forwarded-for': '198.51.100.7', 'x-forwarded-proto': 'https', 'x-academy-proxy-secret': SECRET, host: 'gtl.example.com' });
  assert.equal(admit(req, SECRET), true);
  assert.deepEqual(req.headers, { 'x-forwarded-for': '198.51.100.7', host: 'gtl.example.com' });
});

test('the first entry is the one the proxy saw', () => {
  const req = request({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1', 'x-academy-proxy-secret': SECRET });
  admit(req, SECRET);
  assert.equal(req.headers['x-forwarded-for'], '198.51.100.7');
});

test('the proxy with no X-Forwarded-For leaves the socket\'s address', () => {
  const req = request({ 'x-academy-proxy-secret': SECRET }, '172.18.0.2');
  assert.equal(admit(req, SECRET), true);
  assert.equal(req.headers['x-forwarded-for'], '172.18.0.2');
});

test('a wrong, repeated or unexpected secret is refused', () => {
  assert.equal(admit(request({ 'x-academy-proxy-secret': 'guess', 'x-forwarded-for': '6.6.6.6' }), SECRET), false);
  assert.equal(admit(request({ 'x-academy-proxy-secret': [SECRET, SECRET] as unknown as string }), SECRET), false);
  assert.equal(admit(request({ 'x-academy-proxy-secret': SECRET }), ''), false, 'no secret configured: nothing can present one');
});

test('/healthz is the edge\'s own, and nothing else is', () => {
  assert.equal(isHealthCheck('/healthz'), true);
  for (const url of ['/healthz?x=1', '/healthz/', '/', undefined]) assert.equal(isHealthCheck(url), false, String(url));
});
