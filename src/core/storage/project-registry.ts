/**
 * Project Registry Manager
 * Manages multi-repository support with a central project registry.
 * Projects are registered with their paths and DB locations, and one
 * project can be marked as active at a time.
 */

import * as path from 'path';
import type { DatabaseAdapter } from '../database/database-adapter.js';

export interface ProjectInfo {
  projectId: string;
  repoPath: string;
  displayName: string | null;
  dbPath: string;
  isActive: boolean;
  createdAt: number;
  lastAccessed: number;
}

export class ProjectRegistryManager {
  constructor(private adapter: DatabaseAdapter) {}

  /** Register a new project */
  async register(
    projectId: string,
    repoPath: string,
    displayName?: string
  ): Promise<void> {
    const dbPath = this.computeDbPath(repoPath);
    await this.adapter.registerProject({
      projectId,
      repoPath,
      displayName,
      dbPath,
    });
  }

  /** List all registered projects */
  async list(): Promise<ProjectInfo[]> {
    return this.adapter.getRegisteredProjects();
  }

  /** Switch active project */
  async switchTo(projectId: string): Promise<boolean> {
    const projects = await this.list();
    if (!projects.find((p) => p.projectId === projectId)) return false;
    await this.adapter.setActiveProject(projectId);
    return true;
  }

  /** Remove a project from registry (doesn't delete data) */
  async remove(projectId: string): Promise<boolean> {
    return this.adapter.removeProject(projectId);
  }

  /** Get current active project */
  async getActive(): Promise<ProjectInfo | null> {
    const activeId = await this.adapter.getActiveProject();
    if (!activeId) return null;
    const projects = await this.list();
    return projects.find((p) => p.projectId === activeId) || null;
  }

  /** Auto-detect project from cwd */
  async detectAndRegister(cwd: string): Promise<string> {
    const projectId = path.basename(cwd);
    const existing = await this.list();
    const found = existing.find((p) => p.repoPath === cwd);
    if (found) {
      await this.adapter.touchProject(found.projectId);
      return found.projectId;
    }
    await this.register(projectId, cwd);
    return projectId;
  }

  private computeDbPath(repoPath: string): string {
    return path.join(repoPath, '.stackmemory', 'memory.db');
  }
}
