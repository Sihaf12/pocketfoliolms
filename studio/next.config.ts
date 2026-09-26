import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // The repository root, so packages/shared resolves: the lesson renderer
  // and the brand contract are the same files the API uses.
  turbopack: {
    root: fileURLToPath(new URL('..', import.meta.url)),
    // packages/shared is also compiled by tsc for the API, under NodeNext,
    // so its own imports name the .js it becomes. Here they are the .ts.
    resolveAlias: { './brand.js': '../packages/shared/brand.ts' },
  },
  outputFileTracingRoot: fileURLToPath(new URL('..', import.meta.url)),
};

export default config;
