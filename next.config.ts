import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ['pg'],
  rewrites: async () => ({
    // verify.rssbskp.in (any verify.* host, e.g. verify.localhost) opens the gate check page (the owner, 2026-11-24).
    beforeFiles: [{ source: '/', has: [{ type: 'host', value: 'verify\\..+' }], destination: '/v' }],
  }),
};

export default nextConfig;
