import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.CASEBENCH_ROOT ??= root;

export default {
  ...(process.env.CASEBENCH_NEXT_DIST?{distDir:process.env.CASEBENCH_NEXT_DIST}:{}),
  serverExternalPackages: ['@electric-sql/pglite', 'pg', 'archiver', 'ffmpeg-static', 'playwright', 'playwright-core'],
  outputFileTracingRoot: root,
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' }
      ]
    }];
  }
};
