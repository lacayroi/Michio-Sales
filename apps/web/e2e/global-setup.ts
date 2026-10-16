import { execFileSync } from 'node:child_process';
import path from 'node:path';

export default function globalSetup() {
  if (process.env.E2E_SEED === '0') return;
  execFileSync('pnpm', ['exec', 'tsx', 'prisma/seed.ts'], { cwd: path.resolve(import.meta.dirname, '../../../packages/db'), stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
}
