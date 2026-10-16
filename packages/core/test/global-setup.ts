// Starts a throwaway PostgreSQL 16 (testcontainers) and applies all Prisma migrations.
// Set TEST_DATABASE_URL to reuse an existing empty database instead (e.g. in CI without Docker).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { TestProject } from 'vitest/node';

let stop: (() => Promise<unknown>) | undefined;

export async function setup(project: TestProject) {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    // Docker Desktop on Linux exposes its socket under ~/.docker/desktop.
    const desktopSock = path.join(homedir(), '.docker/desktop/docker.sock');
    if (!process.env.DOCKER_HOST && !existsSync('/var/run/docker.sock') && existsSync(desktopSock)) {
      process.env.DOCKER_HOST = `unix://${desktopSock}`;
    }
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    const container = await new PostgreSqlContainer('postgres:16-alpine').withDatabase('michio_test').start();
    url = container.getConnectionUri();
    stop = () => container.stop();
  }
  const dbDir = path.resolve(import.meta.dirname, '../../db');
  // `shell` on Windows resolves pnpm.cmd (execFile cannot run .cmd shims directly).
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: dbDir, env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe', shell: process.platform === 'win32' });
  project.provide('databaseUrl', url);
}

export async function teardown() {
  await stop?.();
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
