export const DEFAULT_PLANNER_MODEL =
  process.env.STACKMEMORY_MM_PLANNER_MODEL || 'claude-sonnet-4-20250514';
export const DEFAULT_REVIEWER_MODEL =
  process.env.STACKMEMORY_MM_REVIEWER_MODEL || DEFAULT_PLANNER_MODEL;
export const DEFAULT_IMPLEMENTER = (process.env.STACKMEMORY_MM_IMPLEMENTER ||
  'codex') as 'codex' | 'claude';
export const DEFAULT_MAX_ITERS = Number(
  process.env.STACKMEMORY_MM_MAX_ITERS || 2
);

/**
 * Structured response suffix appended to all system prompts.
 * Forces responses to end with actionable choices the user can pick from.
 */
export const STRUCTURED_RESPONSE_SUFFIX = `

Response Format:
- When asking a question, ALWAYS end with structured choices: Yes/No, or numbered options (1, 2, 3, 4), or lettered options (A, B, C, D).
- When completing a task, end with "Done." followed by suggested next steps as numbered options (1, 2, 3, 4).
- Never leave responses open-ended. Always provide explicit options the user can select.
- Keep options concise (one line each). Use the format that best fits: Yes/No for confirmations, 1-4 for action choices, A-D for category selections.`;
