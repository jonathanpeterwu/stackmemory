/**
 * Zod schemas for hook configuration validation
 * Prevents malformed or malicious configs from being loaded
 */

import { z } from 'zod';
import { logConfigInvalid } from './security-logger.js';

// SMS/WhatsApp notification schemas
export const PromptOptionSchema = z.object({
  key: z.string().max(10),
  label: z.string().max(200),
  action: z.string().max(500).optional(),
});

export const PendingPromptSchema = z.object({
  id: z.string().max(32),
  timestamp: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}T/)),
  message: z.string().max(1000),
  options: z.array(PromptOptionSchema).max(10),
  type: z.enum(['options', 'yesno', 'freeform']),
  callback: z.string().max(500).optional(),
  expiresAt: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}T/)),
});

export const NotifyOnSchema = z.object({
  taskComplete: z.boolean(),
  reviewReady: z.boolean(),
  error: z.boolean(),
  custom: z.boolean(),
  contextSync: z.boolean().optional().default(true),
});

export const QuietHoursSchema = z.object({
  enabled: z.boolean(),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

export const SMSConfigSchema = z.object({
  enabled: z.boolean(),
  channel: z.enum(['whatsapp', 'sms']),
  accountSid: z.string().max(100).optional(),
  authToken: z.string().max(100).optional(),
  smsFromNumber: z.string().max(20).optional(),
  smsToNumber: z.string().max(20).optional(),
  whatsappFromNumber: z.string().max(30).optional(),
  whatsappToNumber: z.string().max(30).optional(),
  fromNumber: z.string().max(20).optional(),
  toNumber: z.string().max(20).optional(),
  webhookUrl: z.string().url().max(500).optional(),
  notifyOn: NotifyOnSchema,
  quietHours: QuietHoursSchema.optional(),
  responseTimeout: z.number().int().min(30).max(3600),
  pendingPrompts: z.array(PendingPromptSchema).max(100),
});

// Action queue schemas
export const PendingActionSchema = z.object({
  id: z.string().max(32),
  promptId: z.string().max(32),
  response: z.string().max(1000),
  action: z.string().max(500),
  timestamp: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}T/)),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  result: z.string().max(10000).optional(),
  error: z.string().max(1000).optional(),
});

export const ActionQueueSchema = z.object({
  actions: z.array(PendingActionSchema).max(1000),
  lastChecked: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}T/)),
});

// Auto-background config schema
export const AutoBackgroundConfigSchema = z.object({
  enabled: z.boolean(),
  timeoutMs: z.number().int().min(1000).max(600000),
  alwaysBackground: z.array(z.string().max(200)).max(100),
  neverBackground: z.array(z.string().max(200)).max(100),
  verbose: z.boolean().optional(),
});

// WhatsApp Sync Options schema
export const SyncOptionsSchema = z.object({
  autoSyncOnClose: z.boolean(),
  minFrameDuration: z.number().int().min(0).max(3600), // 0 to 1 hour
  includeDecisions: z.boolean(),
  includeFiles: z.boolean(),
  includeTests: z.boolean(),
  maxDigestLength: z.number().int().min(100).max(1000), // WhatsApp limit ~4096 chars
});

// WhatsApp Schedule Config schema
export const ScheduleConfigSchema = z.object({
  type: z.enum(['daily', 'hourly', 'interval']),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(), // "HH:MM" for daily
  intervalMinutes: z.number().int().min(5).max(1440).optional(), // 5 min to 24 hours
  includeInactive: z.boolean(), // Include when no activity
  quietHoursRespect: z.boolean(), // Respect quiet hours setting
});

// WhatsApp Schedule storage schema
export const ScheduleSchema = z.object({
  id: z.string().max(32),
  config: ScheduleConfigSchema,
  enabled: z.boolean(),
  lastRun: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}T/))
    .optional(),
  nextRun: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}T/))
    .optional(),
  createdAt: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}T/)),
});

export const ScheduleStorageSchema = z.object({
  schedules: z.array(ScheduleSchema).max(10),
  lastChecked: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}T/)),
});

// WhatsApp Command schema
export const WhatsAppCommandSchema = z.object({
  name: z.string().max(50),
  description: z.string().max(200),
  enabled: z.boolean(),
  action: z.string().max(500).optional(), // Safe action to execute
  requiresArg: z.boolean().optional(),
  argPattern: z.string().max(100).optional(), // Regex pattern for arg validation
});

export const WhatsAppCommandsConfigSchema = z.object({
  enabled: z.boolean(),
  commands: z.array(WhatsAppCommandSchema).max(50),
});

// Type exports
export type SMSConfigValidated = z.infer<typeof SMSConfigSchema>;
export type ActionQueueValidated = z.infer<typeof ActionQueueSchema>;
export type AutoBackgroundConfigValidated = z.infer<
  typeof AutoBackgroundConfigSchema
>;
export type SyncOptionsValidated = z.infer<typeof SyncOptionsSchema>;
export type ScheduleConfigValidated = z.infer<typeof ScheduleConfigSchema>;
export type ScheduleValidated = z.infer<typeof ScheduleSchema>;
export type ScheduleStorageValidated = z.infer<typeof ScheduleStorageSchema>;
export type WhatsAppCommandValidated = z.infer<typeof WhatsAppCommandSchema>;
export type WhatsAppCommandsConfigValidated = z.infer<
  typeof WhatsAppCommandsConfigSchema
>;

/**
 * Safely parse and validate config, returning default on failure
 */
export function parseConfigSafe<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  defaultValue: T,
  configName: string
): T {
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  const errors = result.error.issues.map(
    (i) => `${i.path.join('.')}: ${i.message}`
  );
  logConfigInvalid(configName, errors);
  console.error(`[hooks] Invalid ${configName} config:`, errors.join(', '));
  return defaultValue;
}
