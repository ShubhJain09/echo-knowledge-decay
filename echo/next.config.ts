import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  async headers() { return [{ source: '/:path*', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'X-Frame-Options', value: 'DENY' }, { key: 'Referrer-Policy', value: 'same-origin' }, { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }] }]; },
  serverExternalPackages: ['pdf-parse'],
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  outputFileTracingExcludes: { '*': ['.echo-data/**', 'tests/**', 'infra/**', 'tmp/**', '.next-dev/**'] },
};
export default config;
