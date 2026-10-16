import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // Docker image uses the standalone output; Windows dev machines can't create its symlinks without Developer Mode.
  output: process.platform === 'win32' ? undefined : 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
  transpilePackages: ['@michio/auth', '@michio/core', '@michio/db', '@michio/shared', '@michio/channels', '@michio/integrations'],
  serverExternalPackages: ['@node-rs/argon2', '@prisma/client', 'ioredis', 'pino', 'bullmq'],
  poweredByHeader: false,
};

export default config;
