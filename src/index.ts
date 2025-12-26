/**
 * StackMemory - Lossless memory runtime for AI coding tools
 * Main entry point for the StackMemory package
 */

export { FrameManager, type FrameType, type FrameState } from './frame-manager';
export { logger, Logger, LogLevel } from './logger';
export { StackMemoryError, ErrorCode, ErrorHandler } from './error-handler';
export { default as LocalStackMemoryMCP } from './mcp-server';

// Re-export key types
export interface StackMemoryConfig {
  projectRoot?: string;
  dbPath?: string;
  logLevel?: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
}

export interface ContextItem {
  id: string;
  type: string;
  content: string;
  importance: number;
  timestamp: number;
}