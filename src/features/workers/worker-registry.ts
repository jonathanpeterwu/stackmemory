/**
 * Worker Registry
 *
 * Tracks parallel Claude worker sessions spawned via tmux.
 * Each worker gets an isolated state directory for Sweep predictions.
 */

import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { homedir } from 'os';

function workersDir(): string {
  return join(homedir(), '.stackmemory', 'workers');
}

function registryFile(): string {
  return join(workersDir(), 'registry.json');
}

export interface WorkerEntry {
  id: string;
  pane: string;
  pid?: number;
  task?: string;
  cwd: string;
  startedAt: string;
  stateDir: string;
}

export interface WorkerSession {
  sessionName: string;
  workers: WorkerEntry[];
  createdAt: string;
}

export function ensureWorkerStateDir(workerId: string): string {
  const dir = join(workersDir(), workerId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function saveRegistry(session: WorkerSession): void {
  const dir = workersDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(registryFile(), JSON.stringify(session, null, 2));
}

export function loadRegistry(): WorkerSession | null {
  if (!existsSync(registryFile())) return null;
  try {
    return JSON.parse(readFileSync(registryFile(), 'utf-8')) as WorkerSession;
  } catch {
    return null;
  }
}

export function clearRegistry(): void {
  const file = registryFile();
  if (existsSync(file)) {
    rmSync(file, { force: true });
  }
}

export function getWorkersDir(): string {
  return workersDir();
}
