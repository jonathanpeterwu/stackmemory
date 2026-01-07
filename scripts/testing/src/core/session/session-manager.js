/**
 * Session Management for StackMemory
 * Provides session persistence and recovery across CLI invocations
 */
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../monitoring/logger.js';
import { SystemError, ErrorCode } from '../errors/index.js';
export var FrameQueryMode;
(function (FrameQueryMode) {
    FrameQueryMode["CURRENT_SESSION"] = "current";
    FrameQueryMode["PROJECT_ACTIVE"] = "project";
    FrameQueryMode["ALL_ACTIVE"] = "all";
    FrameQueryMode["HISTORICAL"] = "historical";
})(FrameQueryMode || (FrameQueryMode = {}));
export class SessionManager {
    constructor() {
        this.currentSession = null;
        this.STALE_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';
        this.sessionsDir = path.join(homeDir, '.stackmemory', 'sessions');
    }
    static getInstance() {
        if (!SessionManager.instance) {
            SessionManager.instance = new SessionManager();
        }
        return SessionManager.instance;
    }
    async initialize() {
        try {
            await fs.mkdir(this.sessionsDir, { recursive: true });
            await fs.mkdir(path.join(this.sessionsDir, 'projects'), {
                recursive: true,
            });
            await fs.mkdir(path.join(this.sessionsDir, 'history'), {
                recursive: true,
            });
        }
        catch (error) {
            throw new SystemError('Failed to initialize session directories', ErrorCode.INITIALIZATION_ERROR, { error, sessionsDir: this.sessionsDir });
        }
    }
    async getOrCreateSession(options) {
        // 1. Check explicit session ID
        if (options?.sessionId) {
            const session = await this.loadSession(options.sessionId);
            if (session) {
                this.currentSession = session;
                return session;
            }
        }
        // 2. Check environment variable
        const envSessionId = process.env.STACKMEMORY_SESSION;
        if (envSessionId) {
            const session = await this.loadSession(envSessionId);
            if (session) {
                this.currentSession = session;
                return session;
            }
        }
        // 3. Check project + branch context
        const projectHash = await this.getProjectHash(options?.projectPath);
        const branch = options?.branch || (await this.getGitBranch(options?.projectPath));
        if (projectHash) {
            // Try project+branch session
            const branchSession = await this.findProjectBranchSession(projectHash, branch);
            if (branchSession && this.isSessionRecent(branchSession)) {
                await this.touchSession(branchSession);
                this.currentSession = branchSession;
                return branchSession;
            }
            // Try last active for project
            const lastActive = await this.findLastActiveSession(projectHash);
            if (lastActive && this.isSessionRecent(lastActive)) {
                await this.touchSession(lastActive);
                this.currentSession = lastActive;
                return lastActive;
            }
        }
        // 4. Create new session
        const newSession = await this.createSession({
            projectId: projectHash || 'global',
            branch,
            metadata: options?.metadata,
        });
        this.currentSession = newSession;
        return newSession;
    }
    async createSession(params) {
        const session = {
            sessionId: uuidv4(),
            runId: uuidv4(),
            projectId: params.projectId,
            branch: params.branch,
            startedAt: Date.now(),
            lastActiveAt: Date.now(),
            metadata: {
                ...params.metadata,
                user: process.env.USER,
                environment: process.env.NODE_ENV || 'development',
                cliVersion: process.env.npm_package_version,
            },
            state: 'active',
        };
        await this.saveSession(session);
        await this.setProjectActiveSession(params.projectId, session.sessionId);
        // Set as current session
        this.currentSession = session;
        logger.info('Created new session', {
            sessionId: session.sessionId,
            projectId: session.projectId,
            branch: session.branch,
        });
        return session;
    }
    async loadSession(sessionId) {
        try {
            const sessionPath = path.join(this.sessionsDir, `${sessionId}.json`);
            const data = await fs.readFile(sessionPath, 'utf-8');
            return JSON.parse(data);
        }
        catch (error) {
            // Check history
            try {
                const historyPath = path.join(this.sessionsDir, 'history', `${sessionId}.json`);
                const data = await fs.readFile(historyPath, 'utf-8');
                return JSON.parse(data);
            }
            catch {
                return null;
            }
        }
    }
    async saveSession(session) {
        const sessionPath = path.join(this.sessionsDir, `${session.sessionId}.json`);
        await fs.writeFile(sessionPath, JSON.stringify(session, null, 2));
    }
    async suspendSession(sessionId) {
        const id = sessionId || this.currentSession?.sessionId;
        if (!id)
            return;
        const session = await this.loadSession(id);
        if (session) {
            session.state = 'suspended';
            session.lastActiveAt = Date.now();
            await this.saveSession(session);
        }
    }
    async resumeSession(sessionId) {
        const session = await this.loadSession(sessionId);
        if (!session) {
            throw new SystemError('Session not found', ErrorCode.NOT_FOUND, {
                sessionId,
            });
        }
        session.state = 'active';
        session.lastActiveAt = Date.now();
        await this.saveSession(session);
        this.currentSession = session;
        return session;
    }
    async closeSession(sessionId) {
        const id = sessionId || this.currentSession?.sessionId;
        if (!id)
            return;
        const session = await this.loadSession(id);
        if (session) {
            session.state = 'closed';
            session.lastActiveAt = Date.now();
            // Move to history
            const sessionPath = path.join(this.sessionsDir, `${session.sessionId}.json`);
            const historyPath = path.join(this.sessionsDir, 'history', `${session.sessionId}.json`);
            await fs.rename(sessionPath, historyPath);
        }
    }
    async listSessions(filter) {
        const sessions = [];
        // Load active sessions
        const files = await fs.readdir(this.sessionsDir);
        for (const file of files) {
            if (file.endsWith('.json')) {
                const session = await this.loadSession(file.replace('.json', ''));
                if (session) {
                    sessions.push(session);
                }
            }
        }
        // Apply filters
        return sessions.filter((s) => {
            if (filter?.projectId && s.projectId !== filter.projectId)
                return false;
            if (filter?.state && s.state !== filter.state)
                return false;
            if (filter?.branch && s.branch !== filter.branch)
                return false;
            return true;
        });
    }
    async mergeSessions(sourceId, targetId) {
        const source = await this.loadSession(sourceId);
        const target = await this.loadSession(targetId);
        if (!source || !target) {
            throw new SystemError('Session not found for merge', ErrorCode.NOT_FOUND, { sourceId, targetId });
        }
        // Merge metadata
        target.metadata = {
            ...target.metadata,
            ...source.metadata,
            tags: [...(target.metadata.tags || []), ...(source.metadata.tags || [])],
        };
        // Update timestamps
        target.lastActiveAt = Date.now();
        // Close source session
        await this.closeSession(sourceId);
        await this.saveSession(target);
        logger.info('Merged sessions', {
            source: sourceId,
            target: targetId,
        });
        return target;
    }
    async cleanupStaleSessions(maxAge = 30 * 24 * 60 * 60 * 1000) {
        const historyDir = path.join(this.sessionsDir, 'history');
        const files = await fs.readdir(historyDir);
        const cutoff = Date.now() - maxAge;
        let cleaned = 0;
        for (const file of files) {
            if (file.endsWith('.json')) {
                const filePath = path.join(historyDir, file);
                const stats = await fs.stat(filePath);
                if (stats.mtimeMs < cutoff) {
                    await fs.unlink(filePath);
                    cleaned++;
                }
            }
        }
        logger.info(`Cleaned up ${cleaned} stale sessions`);
        return cleaned;
    }
    getCurrentSession() {
        return this.currentSession;
    }
    getSessionRunId() {
        return this.currentSession?.runId || uuidv4();
    }
    async getProjectHash(projectPath) {
        try {
            const cwd = projectPath || process.cwd();
            const pathModule = await import('path');
            // Try to get git remote first (consistent with project-manager)
            let identifier;
            try {
                const { execSync } = await import('child_process');
                identifier = execSync('git config --get remote.origin.url', {
                    cwd,
                    encoding: 'utf-8',
                    timeout: 5000,
                }).trim();
            }
            catch {
                // Fall back to directory path
                identifier = cwd;
            }
            // Use same algorithm as project-manager.generateProjectId
            const cleaned = identifier
                .replace(/\.git$/, '')
                .replace(/[^a-zA-Z0-9-]/g, '-')
                .toLowerCase();
            return cleaned.substring(cleaned.length - 50);
        }
        catch {
            return null;
        }
    }
    async getGitBranch(projectPath) {
        try {
            const { execSync } = await import('child_process');
            const cwd = projectPath || process.cwd();
            const branch = execSync('git rev-parse --abbrev-ref HEAD', {
                cwd,
                encoding: 'utf-8',
            }).trim();
            return branch;
        }
        catch {
            return undefined;
        }
    }
    async findProjectBranchSession(projectHash, branch) {
        if (!branch)
            return null;
        const sessions = await this.listSessions({
            projectId: projectHash,
            state: 'active',
            branch,
        });
        return sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0] || null;
    }
    async findLastActiveSession(projectHash) {
        const sessions = await this.listSessions({
            projectId: projectHash,
            state: 'active',
        });
        return sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0] || null;
    }
    async setProjectActiveSession(projectId, sessionId) {
        const projectFile = path.join(this.sessionsDir, 'projects', `${projectId}.json`);
        await fs.writeFile(projectFile, JSON.stringify({
            projectId,
            activeSessionId: sessionId,
            updatedAt: Date.now(),
        }, null, 2));
    }
    isSessionRecent(session) {
        return Date.now() - session.lastActiveAt < this.STALE_THRESHOLD;
    }
    async touchSession(session) {
        session.lastActiveAt = Date.now();
        await this.saveSession(session);
    }
}
export const sessionManager = SessionManager.getInstance();
