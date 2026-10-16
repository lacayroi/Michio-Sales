// Integration test database (SPEC §12: testcontainers).
// - TEST_DATABASE_URL set → use that database (migrated, never wiped: every test builds its own org). Handy where Docker
//   isn't reachable from Node (e.g. Docker inside WSL on Windows).
// - otherwise → start a throwaway postgres:16 container.
import { execSync } from 'node:child_process';
import path from 'node:path';
import type { TestProject } from 'vitest/node';

const dbPackage = path.resolve(import.meta.dirname, '../../db');

export default async function setup(project: TestProject) {
  let url = process.env.TEST_DATABASE_URL;
  let stop: (() => Promise<unknown>) | undefined;

  if (!url) {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    const container = await new PostgreSqlContainer('postgres:16-alpine').withDatabase('michio_test').start();
    url = container.getConnectionUri();
    stop = () => container.stop();
  }
  if (!/test/i.test(new URL(url).pathname)) throw new Error(`Refusing to run integration tests against non-test database ${url}`);

  const env = { ...process.env, DATABASE_URL: url };
  execSync('npx prisma migrate deploy', { cwd: dbPackage, env, stdio: 'pipe' });

  const u = new URL(url);
  u.searchParams.set('connection_limit', '25');
  project.provide('databaseUrl', u.toString());
  return async () => {
    await stop?.();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
