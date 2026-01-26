/**
 * Zod schemas for MCP tool input validation
 * These schemas validate tool parameters before processing
 */

import { z } from 'zod';

// ============================================
// Context Tools
// ============================================

export const GetContextSchema = z.object({
  query: z.string().min(1).max(5000).optional(),
  limit: z.number().int().min(1).max(100).default(10),
});
export type GetContextInput = z.infer<typeof GetContextSchema>;

export const AddDecisionSchema = z.object({
  content: z.string().min(1).max(10000),
  type: z.enum(['decision', 'constraint', 'learning']),
});
export type AddDecisionInput = z.infer<typeof AddDecisionSchema>;

// ============================================
// Frame Tools
// ============================================

export const StartFrameSchema = z.object({
  name: z.string().min(1).max(500),
  type: z.enum(['task', 'subtask', 'tool_scope', 'review', 'write', 'debug']),
  constraints: z.array(z.string().max(1000)).optional(),
});
export type StartFrameInput = z.infer<typeof StartFrameSchema>;

export const CloseFrameSchema = z.object({
  result: z.string().max(10000).optional(),
  outputs: z.record(z.unknown()).optional(),
});
export type CloseFrameInput = z.infer<typeof CloseFrameSchema>;

export const AddAnchorSchema = z.object({
  type: z.enum([
    'FACT',
    'DECISION',
    'CONSTRAINT',
    'INTERFACE_CONTRACT',
    'TODO',
    'RISK',
  ]),
  text: z.string().min(1).max(10000),
  priority: z.number().int().min(0).max(10).default(5),
});
export type AddAnchorInput = z.infer<typeof AddAnchorSchema>;

export const GetHotStackSchema = z.object({
  maxDepth: z.number().int().min(1).max(50).default(10),
});
export type GetHotStackInput = z.infer<typeof GetHotStackSchema>;

// ============================================
// Task Tools
// ============================================

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  tags: z.array(z.string().max(100)).optional(),
  parentId: z.string().uuid().optional(),
});
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

export const UpdateTaskStatusSchema = z.object({
  taskId: z.string().min(1),
  status: z.enum(['pending', 'in_progress', 'completed', 'blocked']),
  note: z.string().max(5000).optional(),
});
export type UpdateTaskStatusInput = z.infer<typeof UpdateTaskStatusSchema>;

export const GetActiveTasksSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'blocked']).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type GetActiveTasksInput = z.infer<typeof GetActiveTasksSchema>;

export const AddTaskDependencySchema = z.object({
  taskId: z.string().min(1),
  dependsOn: z.string().min(1),
});
export type AddTaskDependencyInput = z.infer<typeof AddTaskDependencySchema>;

// ============================================
// Linear Integration Tools
// ============================================

export const LinearSyncSchema = z.object({
  direction: z.enum(['to_linear', 'from_linear', 'bidirectional']).optional(),
  force: z.boolean().default(false),
});
export type LinearSyncInput = z.infer<typeof LinearSyncSchema>;

export const LinearUpdateTaskSchema = z.object({
  taskId: z.string().min(1),
  updates: z.object({
    title: z.string().min(1).max(500).optional(),
    description: z.string().max(10000).optional(),
    status: z.string().optional(),
    priority: z.number().int().min(0).max(4).optional(),
  }),
});
export type LinearUpdateTaskInput = z.infer<typeof LinearUpdateTaskSchema>;

export const LinearGetTasksSchema = z.object({
  status: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type LinearGetTasksInput = z.infer<typeof LinearGetTasksSchema>;

// ============================================
// Trace Tools
// ============================================

export const GetTracesSchema = z.object({
  sessionId: z.string().optional(),
  limit: z.number().int().min(1).max(1000).default(100),
  since: z.string().datetime().optional(),
});
export type GetTracesInput = z.infer<typeof GetTracesSchema>;

export const CompressOldTracesSchema = z.object({
  olderThanDays: z.number().int().min(1).max(365).default(7),
});
export type CompressOldTracesInput = z.infer<typeof CompressOldTracesSchema>;

// ============================================
// Smart Context Tools
// ============================================

export const SmartContextSchema = z.object({
  query: z.string().min(1).max(5000),
  maxResults: z.number().int().min(1).max(50).default(10),
  includeRelated: z.boolean().default(true),
});
export type SmartContextInput = z.infer<typeof SmartContextSchema>;

export const GetSummarySchema = z.object({
  timeRange: z
    .object({
      start: z.string().datetime(),
      end: z.string().datetime(),
    })
    .optional(),
  includeMetrics: z.boolean().default(true),
});
export type GetSummaryInput = z.infer<typeof GetSummarySchema>;

// ============================================
// Discovery Tools
// ============================================

export const DiscoverSchema = z.object({
  pattern: z.string().max(500).optional(),
  maxDepth: z.number().int().min(1).max(20).default(5),
});
export type DiscoverInput = z.infer<typeof DiscoverSchema>;

export const RelatedFilesSchema = z.object({
  filePath: z.string().min(1).max(1000),
  limit: z.number().int().min(1).max(50).default(10),
});
export type RelatedFilesInput = z.infer<typeof RelatedFilesSchema>;

export const SearchSchema = z.object({
  query: z.string().min(1).max(1000),
  type: z.enum(['code', 'context', 'task', 'all']).default('all'),
  limit: z.number().int().min(1).max(100).default(20),
});
export type SearchInput = z.infer<typeof SearchSchema>;

// ============================================
// Validation Helper
// ============================================

import { ValidationError, ErrorCode } from '../../core/errors/index.js';

/**
 * Validate input using a Zod schema
 * Throws ValidationError with details if validation fails
 */
export function validateInput<T>(
  schema: z.ZodSchema<T>,
  input: unknown,
  toolName: string
): T {
  const result = schema.safeParse(input);

  if (!result.success) {
    const errors = result.error.errors.map((e) => ({
      path: e.path.join('.'),
      message: e.message,
    }));

    throw new ValidationError(
      `Invalid input for tool '${toolName}': ${errors.map((e) => e.message).join(', ')}`,
      ErrorCode.VALIDATION_FAILED,
      { toolName, errors }
    );
  }

  return result.data;
}
