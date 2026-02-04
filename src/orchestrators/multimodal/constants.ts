export const DEFAULT_PLANNER_MODEL =
  process.env.STACKMEMORY_MM_PLANNER_MODEL || 'claude-3-5-sonnet-latest';
export const DEFAULT_REVIEWER_MODEL =
  process.env.STACKMEMORY_MM_REVIEWER_MODEL || DEFAULT_PLANNER_MODEL;
export const DEFAULT_IMPLEMENTER = (process.env.STACKMEMORY_MM_IMPLEMENTER ||
  'codex') as 'codex' | 'claude';
export const DEFAULT_MAX_ITERS = Number(
  process.env.STACKMEMORY_MM_MAX_ITERS || 2
);
