/**
 * Repository Ingestion Skill for ChromaDB
 *
 * Ingests and maintains code repositories in ChromaDB for enhanced code search and context
 */

import { ChromaDBAdapter } from '../core/storage/chromadb-adapter.js';
import { Logger } from '../core/monitoring/logger.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import ignore from 'ignore';

export interface RepoIngestionOptions {
  incremental?: boolean;
  forceUpdate?: boolean;
  includeTests?: boolean;
  includeDocs?: boolean;
  maxFileSize?: number;
  chunkSize?: number;
  extensions?: string[];
  excludePatterns?: string[];
}

export interface RepoMetadata {
  repoId: string;
  repoName: string;
  branch: string;
  lastCommit: string;
  lastIngested: number;
  filesCount: number;
  totalSize: number;
  language: string;
  framework?: string;
}

export interface FileChunk {
  id: string;
  filePath: string;
  content: string;
  startLine: number;
  endLine: number;
  hash: string;
  language: string;
}

export class RepoIngestionSkill {
  private logger: Logger;
  private adapter: ChromaDBAdapter;
  private metadataCache: Map<string, RepoMetadata> = new Map();
  private fileHashCache: Map<string, string> = new Map();

  constructor(
    private config: {
      apiKey: string;
      tenant: string;
      database: string;
      collectionName?: string;
    },
    private userId: string,
    private teamId?: string
  ) {
    this.logger = new Logger('RepoIngestionSkill');
    this.adapter = new ChromaDBAdapter(
      {
        ...config,
        collectionName: config.collectionName || 'stackmemory_repos',
      },
      userId,
      teamId
    );
  }

  async initialize(): Promise<void> {
    await this.adapter.initialize();
    await this.loadMetadataCache();
  }

  /**
   * Ingest a repository into ChromaDB
   */
  async ingestRepository(
    repoPath: string,
    repoName: string,
    options: RepoIngestionOptions = {}
  ): Promise<{
    success: boolean;
    message: string;
    stats?: {
      filesProcessed: number;
      chunksCreated: number;
      timeElapsed: number;
      totalSize: number;
    };
  }> {
    const startTime = Date.now();

    try {
      this.logger.info(`Starting repository ingestion for ${repoName}`);

      // Validate repository path
      if (!fs.existsSync(repoPath)) {
        throw new Error(`Repository path not found: ${repoPath}`);
      }

      // Get repository metadata
      const metadata = await this.getRepoMetadata(repoPath, repoName);

      // Check if incremental update is possible
      const existingMetadata = this.metadataCache.get(metadata.repoId);
      if (options.incremental && existingMetadata && !options.forceUpdate) {
        const changedFiles = await this.getChangedFiles(
          repoPath,
          existingMetadata.lastCommit,
          metadata.lastCommit
        );

        if (changedFiles.length === 0) {
          return {
            success: true,
            message: 'No changes detected since last ingestion',
          };
        }

        this.logger.info(
          `Incremental update: ${changedFiles.length} files changed`
        );
      }

      // Get files to process
      const files = await this.getRepoFiles(repoPath, options);
      this.logger.info(`Found ${files.length} files to process`);

      // Process files and create chunks
      let filesProcessed = 0;
      let chunksCreated = 0;
      let totalSize = 0;

      for (const file of files) {
        try {
          const chunks = await this.processFile(
            file,
            repoPath,
            repoName,
            metadata,
            options
          );

          for (const chunk of chunks) {
            await this.storeChunk(chunk, metadata);
            chunksCreated++;
          }

          filesProcessed++;
          totalSize += fs.statSync(file).size;

          // Log progress every 100 files
          if (filesProcessed % 100 === 0) {
            this.logger.info(
              `Processed ${filesProcessed}/${files.length} files`
            );
          }
        } catch (error: unknown) {
          this.logger.warn(`Failed to process file ${file}:`, error);
        }
      }

      // Update metadata
      metadata.filesCount = filesProcessed;
      metadata.totalSize = totalSize;
      metadata.lastIngested = Date.now();
      await this.saveMetadata(metadata);

      const timeElapsed = Date.now() - startTime;

      this.logger.info(
        `Repository ingestion complete: ${filesProcessed} files, ${chunksCreated} chunks in ${timeElapsed}ms`
      );

      return {
        success: true,
        message: `Successfully ingested ${repoName}`,
        stats: {
          filesProcessed,
          chunksCreated,
          timeElapsed,
          totalSize,
        },
      };
    } catch (error: unknown) {
      this.logger.error('Repository ingestion failed:', error);
      return {
        success: false,
        message: `Failed to ingest repository: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Update an existing repository in ChromaDB
   */
  async updateRepository(
    repoPath: string,
    repoName: string,
    options: RepoIngestionOptions = {}
  ): Promise<{
    success: boolean;
    message: string;
    stats?: {
      filesUpdated: number;
      filesAdded: number;
      filesRemoved: number;
      timeElapsed: number;
    };
  }> {
    const startTime = Date.now();

    try {
      const metadata = await this.getRepoMetadata(repoPath, repoName);
      const existingMetadata = this.metadataCache.get(metadata.repoId);

      if (!existingMetadata) {
        // No existing data, perform full ingestion
        return this.ingestRepository(repoPath, repoName, options);
      }

      // Get changed files since last ingestion
      const changedFiles = await this.getChangedFiles(
        repoPath,
        existingMetadata.lastCommit,
        metadata.lastCommit
      );

      if (changedFiles.length === 0) {
        return {
          success: true,
          message: 'No changes detected',
          stats: {
            filesUpdated: 0,
            filesAdded: 0,
            filesRemoved: 0,
            timeElapsed: Date.now() - startTime,
          },
        };
      }

      let filesUpdated = 0;
      let filesAdded = 0;
      let filesRemoved = 0;

      for (const change of changedFiles) {
        const filePath = path.join(repoPath, change.path);

        if (change.status === 'deleted') {
          await this.removeFileChunks(change.path, metadata.repoId);
          filesRemoved++;
        } else if (change.status === 'added') {
          const chunks = await this.processFile(
            filePath,
            repoPath,
            repoName,
            metadata,
            options
          );
          for (const chunk of chunks) {
            await this.storeChunk(chunk, metadata);
          }
          filesAdded++;
        } else if (change.status === 'modified') {
          // Remove old chunks and add new ones
          await this.removeFileChunks(change.path, metadata.repoId);
          const chunks = await this.processFile(
            filePath,
            repoPath,
            repoName,
            metadata,
            options
          );
          for (const chunk of chunks) {
            await this.storeChunk(chunk, metadata);
          }
          filesUpdated++;
        }
      }

      // Update metadata
      metadata.lastIngested = Date.now();
      await this.saveMetadata(metadata);

      const timeElapsed = Date.now() - startTime;

      return {
        success: true,
        message: `Successfully updated ${repoName}`,
        stats: {
          filesUpdated,
          filesAdded,
          filesRemoved,
          timeElapsed,
        },
      };
    } catch (error: unknown) {
      this.logger.error('Repository update failed:', error);
      return {
        success: false,
        message: `Failed to update repository: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Search code in ingested repositories
   */
  async searchCode(
    query: string,
    options?: {
      repoName?: string;
      language?: string;
      limit?: number;
      includeContext?: boolean;
    }
  ): Promise<
    Array<{
      filePath: string;
      content: string;
      score: number;
      startLine: number;
      endLine: number;
      repoName: string;
    }>
  > {
    try {
      const filters: any = {
        type: ['code_chunk'],
      };

      if (options?.repoName) {
        filters.repo_name = options.repoName;
      }

      if (options?.language) {
        filters.language = options.language;
      }

      const results = await this.adapter.queryContexts(
        query,
        options?.limit || 20,
        filters
      );

      return results.map((result) => ({
        filePath: result.metadata.file_path,
        content: result.content,
        score: 1 - result.distance, // Convert distance to similarity score
        startLine: result.metadata.start_line,
        endLine: result.metadata.end_line,
        repoName: result.metadata.repo_name,
      }));
    } catch (error: unknown) {
      this.logger.error('Code search failed:', error);
      return [];
    }
  }

  /**
   * Get repository metadata
   */
  private async getRepoMetadata(
    repoPath: string,
    repoName: string
  ): Promise<RepoMetadata> {
    const branch = this.getCurrentBranch(repoPath);
    const lastCommit = this.getLastCommit(repoPath);
    const repoId = `${repoName}_${branch}`.replace(/[^a-zA-Z0-9_-]/g, '_');

    // Detect primary language and framework
    const { language, framework } =
      await this.detectLanguageAndFramework(repoPath);

    return {
      repoId,
      repoName,
      branch,
      lastCommit,
      lastIngested: Date.now(),
      filesCount: 0,
      totalSize: 0,
      language,
      framework,
    };
  }

  /**
   * Get current git branch
   */
  private getCurrentBranch(repoPath: string): string {
    try {
      return execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: repoPath,
        encoding: 'utf8',
      }).trim();
    } catch {
      return 'main';
    }
  }

  /**
   * Get last commit hash
   */
  private getLastCommit(repoPath: string): string {
    try {
      return execSync('git rev-parse HEAD', {
        cwd: repoPath,
        encoding: 'utf8',
      }).trim();
    } catch {
      return 'unknown';
    }
  }

  /**
   * Get changed files between commits
   */
  private async getChangedFiles(
    repoPath: string,
    fromCommit: string,
    toCommit: string
  ): Promise<Array<{ path: string; status: string }>> {
    try {
      const diff = execSync(
        `git diff --name-status ${fromCommit}..${toCommit}`,
        {
          cwd: repoPath,
          encoding: 'utf8',
        }
      );

      return diff
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const [status, ...pathParts] = line.split('\t');
          return {
            path: pathParts.join('\t'),
            status:
              status === 'A'
                ? 'added'
                : status === 'D'
                  ? 'deleted'
                  : 'modified',
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Get repository files to process
   */
  private async getRepoFiles(
    repoPath: string,
    options: RepoIngestionOptions
  ): Promise<string[]> {
    const files: string[] = [];
    const ig = ignore();

    // Load .gitignore if it exists
    const gitignorePath = path.join(repoPath, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      ig.add(fs.readFileSync(gitignorePath, 'utf8'));
    }

    // Add default exclude patterns
    const defaultExcludes = [
      'node_modules',
      '.git',
      'dist',
      'build',
      'coverage',
      '.env',
      '*.log',
      ...(options.excludePatterns || []),
    ];
    ig.add(defaultExcludes);

    // Default extensions to include
    const extensions = options.extensions || [
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.py',
      '.java',
      '.go',
      '.rs',
      '.c',
      '.cpp',
      '.h',
      '.hpp',
      '.cs',
      '.rb',
      '.php',
      '.swift',
      '.kt',
      '.scala',
      '.r',
      '.m',
      '.sql',
      '.yaml',
      '.yml',
      '.json',
    ];

    // Add documentation if requested
    if (options.includeDocs) {
      extensions.push('.md', '.rst', '.txt');
    }

    const maxFileSize = options.maxFileSize || 1024 * 1024; // 1MB default

    const walkDir = (dir: string, baseDir: string = repoPath) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(baseDir, fullPath);

        if (ig.ignores(relativePath)) {
          continue;
        }

        if (entry.isDirectory()) {
          walkDir(fullPath, baseDir);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);

          // Check if file should be included
          if (!extensions.includes(ext)) {
            continue;
          }

          // Check if it's a test file
          if (
            !options.includeTests &&
            (entry.name.includes('.test.') ||
              entry.name.includes('.spec.') ||
              relativePath.includes('__tests__') ||
              relativePath.includes('test/') ||
              relativePath.includes('tests/'))
          ) {
            continue;
          }

          // Check file size
          const stats = fs.statSync(fullPath);
          if (stats.size > maxFileSize) {
            this.logger.debug(`Skipping large file: ${relativePath}`);
            continue;
          }

          files.push(fullPath);
        }
      }
    };

    walkDir(repoPath);
    return files;
  }

  /**
   * Process a file into chunks
   */
  private async processFile(
    filePath: string,
    repoPath: string,
    repoName: string,
    metadata: RepoMetadata,
    options: RepoIngestionOptions
  ): Promise<FileChunk[]> {
    const relativePath = path.relative(repoPath, filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const language = this.detectFileLanguage(filePath);

    const chunkSize = options.chunkSize || 100; // 100 lines per chunk
    const chunks: FileChunk[] = [];

    // Calculate file hash for caching
    const fileHash = crypto.createHash('md5').update(content).digest('hex');

    // Check if file has changed
    const cachedHash = this.fileHashCache.get(relativePath);
    if (cachedHash === fileHash && !options.forceUpdate) {
      return []; // File hasn't changed
    }

    this.fileHashCache.set(relativePath, fileHash);

    // Split into chunks
    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunkLines = lines.slice(i, Math.min(i + chunkSize, lines.length));
      const chunkContent = chunkLines.join('\n');

      if (chunkContent.trim().length === 0) {
        continue; // Skip empty chunks
      }

      const chunkId = `${metadata.repoId}_${relativePath}_${i}`;
      const chunkHash = crypto
        .createHash('md5')
        .update(chunkContent)
        .digest('hex');

      chunks.push({
        id: chunkId,
        filePath: relativePath,
        content: chunkContent,
        startLine: i + 1,
        endLine: Math.min(i + chunkSize, lines.length),
        hash: chunkHash,
        language,
      });
    }

    return chunks;
  }

  /**
   * Store a chunk in ChromaDB
   */
  private async storeChunk(
    chunk: FileChunk,
    metadata: RepoMetadata
  ): Promise<void> {
    const documentContent = `File: ${chunk.filePath} (Lines ${chunk.startLine}-${chunk.endLine})
Language: ${chunk.language}
Repository: ${metadata.repoName}/${metadata.branch}

${chunk.content}`;

    await this.adapter.storeContext('observation', documentContent, {
      type: 'code_chunk',
      repo_id: metadata.repoId,
      repo_name: metadata.repoName,
      branch: metadata.branch,
      file_path: chunk.filePath,
      start_line: chunk.startLine,
      end_line: chunk.endLine,
      language: chunk.language,
      framework: metadata.framework,
      chunk_hash: chunk.hash,
      last_commit: metadata.lastCommit,
    });
  }

  /**
   * Remove file chunks from ChromaDB
   */
  private async removeFileChunks(
    filePath: string,
    repoId: string
  ): Promise<void> {
    // This would need to be implemented in ChromaDBAdapter
    // For now, we'll log it
    this.logger.debug(
      `Would remove chunks for file: ${filePath} from repo: ${repoId}`
    );
  }

  /**
   * Detect file language
   */
  private detectFileLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const languageMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.py': 'python',
      '.java': 'java',
      '.go': 'go',
      '.rs': 'rust',
      '.c': 'c',
      '.cpp': 'cpp',
      '.cs': 'csharp',
      '.rb': 'ruby',
      '.php': 'php',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.scala': 'scala',
      '.r': 'r',
      '.sql': 'sql',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.json': 'json',
      '.md': 'markdown',
    };

    return languageMap[ext] || 'unknown';
  }

  /**
   * Detect language and framework
   */
  private async detectLanguageAndFramework(repoPath: string): Promise<{
    language: string;
    framework?: string;
  }> {
    // Check for package.json (JavaScript/TypeScript)
    const packageJsonPath = path.join(repoPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(
          fs.readFileSync(packageJsonPath, 'utf8')
        );
        const deps = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
        };

        let framework: string | undefined;
        if (deps.react) framework = 'react';
        else if (deps.vue) framework = 'vue';
        else if (deps.angular) framework = 'angular';
        else if (deps.express) framework = 'express';
        else if (deps.next) framework = 'nextjs';
        else if (deps.svelte) framework = 'svelte';

        return {
          language: deps.typescript ? 'typescript' : 'javascript',
          framework,
        };
      } catch {}
    }

    // Check for requirements.txt or setup.py (Python)
    if (
      fs.existsSync(path.join(repoPath, 'requirements.txt')) ||
      fs.existsSync(path.join(repoPath, 'setup.py'))
    ) {
      return { language: 'python' };
    }

    // Check for go.mod (Go)
    if (fs.existsSync(path.join(repoPath, 'go.mod'))) {
      return { language: 'go' };
    }

    // Check for Cargo.toml (Rust)
    if (fs.existsSync(path.join(repoPath, 'Cargo.toml'))) {
      return { language: 'rust' };
    }

    // Check for pom.xml or build.gradle (Java)
    if (
      fs.existsSync(path.join(repoPath, 'pom.xml')) ||
      fs.existsSync(path.join(repoPath, 'build.gradle'))
    ) {
      return { language: 'java' };
    }

    // Default to unknown
    return { language: 'unknown' };
  }

  /**
   * Load metadata cache
   */
  private async loadMetadataCache(): Promise<void> {
    // In a real implementation, this would load from a persistent store
    // For now, we'll just initialize an empty cache
    this.metadataCache.clear();
  }

  /**
   * Save metadata
   */
  private async saveMetadata(metadata: RepoMetadata): Promise<void> {
    this.metadataCache.set(metadata.repoId, metadata);
    // In a real implementation, this would persist to a store
  }

  /**
   * Get repository statistics
   */
  async getRepoStats(repoName?: string): Promise<{
    totalRepos: number;
    totalFiles: number;
    totalChunks: number;
    languages: Record<string, number>;
    frameworks: Record<string, number>;
  }> {
    // This would query ChromaDB for statistics
    const stats = {
      totalRepos: this.metadataCache.size,
      totalFiles: 0,
      totalChunks: 0,
      languages: {} as Record<string, number>,
      frameworks: {} as Record<string, number>,
    };

    for (const metadata of this.metadataCache.values()) {
      if (!repoName || metadata.repoName === repoName) {
        stats.totalFiles += metadata.filesCount;

        if (metadata.language) {
          stats.languages[metadata.language] =
            (stats.languages[metadata.language] || 0) + 1;
        }

        if (metadata.framework) {
          stats.frameworks[metadata.framework] =
            (stats.frameworks[metadata.framework] || 0) + 1;
        }
      }
    }

    return stats;
  }
}
