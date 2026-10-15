import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
  transpilePackages: ['@michio/auth', '@michio/core', '@michio/db', '@michio/shared', '@michio/channels'],
  serverExternalPackages: ['@node-rs/argon2', '@prisma/client', 'ioredis', 'pino'],
  poweredByHeader: false,
};

export default config;
