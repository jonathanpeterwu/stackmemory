/**
 * WhatsApp Scheduled Digest Manager
 * Schedule periodic context digests
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';
import { writeFileSecure, ensureSecureDir } from './secure-fs.js';
import { ScheduleStorageSchema, parseConfigSafe } from './schemas.js';
import {
  getFrameDigestData,
  generateMobileDigest,
  loadSyncOptions,
} from './whatsapp-sync.js';
import { sendNotification, loadSMSConfig } from './sms-notify.js';

export interface ScheduleConfig {
  type: 'daily' | 'hourly' | 'interval';
  time?: string; // "HH:MM" for daily
  intervalMinutes?: number; // for interval type
  includeInactive?: boolean; // include when no activity
  quietHoursRespect: boolean;
}

export interface Schedule {
  id: string;
  config: ScheduleConfig;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  createdAt: string;
}

interface ScheduleStorage {
  schedules: Schedule[];
  lastChecked: string;
}

const STORAGE_PATH = join(homedir(), '.stackmemory', 'whatsapp-schedules.json');

const DEFAULT_STORAGE: ScheduleStorage = {
  schedules: [],
  lastChecked: new Date().toISOString(),
};

// Active scheduler interval handle
let schedulerInterval: NodeJS.Timeout | null = null;

/**
 * Load schedule storage
 */
function loadStorage(): ScheduleStorage {
  try {
    if (existsSync(STORAGE_PATH)) {
      const data = JSON.parse(readFileSync(STORAGE_PATH, 'utf8'));
      return parseConfigSafe(
        ScheduleStorageSchema,
        data,
        DEFAULT_STORAGE,
        'whatsapp-schedules'
      );
    }
  } catch {
    // Use defaults
  }
  return { ...DEFAULT_STORAGE, lastChecked: new Date().toISOString() };
}

/**
 * Save schedule storage
 */
function saveStorage(storage: ScheduleStorage): void {
  try {
    ensureSecureDir(join(homedir(), '.stackmemory'));
    writeFileSecure(STORAGE_PATH, JSON.stringify(storage, null, 2));
  } catch {
    // Silently fail
  }
}

/**
 * Generate unique schedule ID
 */
function generateScheduleId(): string {
  return randomBytes(6).toString('hex');
}

/**
 * Parse time string to hours and minutes
 */
function parseTime(time: string): { hours: number; minutes: number } | null {
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return { hours, minutes };
}

/**
 * Calculate next run time for a schedule
 */
function calculateNextRun(config: ScheduleConfig, fromDate?: Date): Date {
  const now = fromDate || new Date();

  switch (config.type) {
    case 'daily': {
      const time = config.time
        ? parseTime(config.time)
        : { hours: 9, minutes: 0 };
      if (!time) {
        throw new Error(`Invalid time format: ${config.time}`);
      }

      const next = new Date(now);
      next.setHours(time.hours, time.minutes, 0, 0);

      // If the time has passed today, schedule for tomorrow
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }

      return next;
    }

    case 'hourly': {
      const next = new Date(now);
      next.setMinutes(0, 0, 0);
      next.setHours(next.getHours() + 1);
      return next;
    }

    case 'interval': {
      const intervalMinutes = config.intervalMinutes || 60;
      const next = new Date(now.getTime() + intervalMinutes * 60 * 1000);
      return next;
    }

    default:
      throw new Error(`Unknown schedule type: ${config.type}`);
  }
}

/**
 * Check if current time is within quiet hours
 */
function isQuietHours(): boolean {
  const smsConfig = loadSMSConfig();

  if (!smsConfig.quietHours?.enabled) {
    return false;
  }

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const startTime = parseTime(smsConfig.quietHours.start);
  const endTime = parseTime(smsConfig.quietHours.end);

  if (!startTime || !endTime) {
    return false;
  }

  const startMinutes = startTime.hours * 60 + startTime.minutes;
  const endMinutes = endTime.hours * 60 + endTime.minutes;

  // Handle overnight quiet hours (e.g., 22:00 - 08:00)
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

/**
 * Schedule a periodic digest
 */
export function scheduleDigest(config: ScheduleConfig): string {
  const storage = loadStorage();

  const id = generateScheduleId();
  const nextRun = calculateNextRun(config);

  const schedule: Schedule = {
    id,
    config,
    enabled: true,
    nextRun: nextRun.toISOString(),
    createdAt: new Date().toISOString(),
  };

  storage.schedules.push(schedule);
  saveStorage(storage);

  console.log(
    `[whatsapp-scheduler] Created schedule ${id}, next run: ${nextRun.toISOString()}`
  );

  return id;
}

/**
 * Cancel a schedule
 */
export function cancelSchedule(scheduleId: string): boolean {
  const storage = loadStorage();
  const initialLength = storage.schedules.length;

  storage.schedules = storage.schedules.filter((s) => s.id !== scheduleId);

  if (storage.schedules.length < initialLength) {
    saveStorage(storage);
    console.log(`[whatsapp-scheduler] Cancelled schedule ${scheduleId}`);
    return true;
  }

  return false;
}

/**
 * Enable/disable a schedule
 */
export function setScheduleEnabled(
  scheduleId: string,
  enabled: boolean
): boolean {
  const storage = loadStorage();
  const schedule = storage.schedules.find((s) => s.id === scheduleId);

  if (!schedule) {
    return false;
  }

  schedule.enabled = enabled;

  if (enabled) {
    schedule.nextRun = calculateNextRun(schedule.config).toISOString();
  }

  saveStorage(storage);
  return true;
}

/**
 * List all schedules
 */
export function listSchedules(): Schedule[] {
  const storage = loadStorage();
  return storage.schedules;
}

/**
 * Get a specific schedule
 */
export function getSchedule(scheduleId: string): Schedule | undefined {
  const storage = loadStorage();
  return storage.schedules.find((s) => s.id === scheduleId);
}

/**
 * Generate activity summary for digest
 */
async function generateActivitySummary(): Promise<string | null> {
  const data = await getFrameDigestData();

  if (!data) {
    return null;
  }

  const options = loadSyncOptions();
  return generateMobileDigest(data, options);
}

/**
 * Run a scheduled digest now
 */
export async function runScheduledDigest(scheduleId: string): Promise<{
  success: boolean;
  sent: boolean;
  message?: string;
  error?: string;
}> {
  const storage = loadStorage();
  const schedule = storage.schedules.find((s) => s.id === scheduleId);

  if (!schedule) {
    return {
      success: false,
      sent: false,
      error: `Schedule not found: ${scheduleId}`,
    };
  }

  if (!schedule.enabled) {
    return { success: false, sent: false, error: 'Schedule is disabled' };
  }

  // Check quiet hours
  if (schedule.config.quietHoursRespect && isQuietHours()) {
    return {
      success: true,
      sent: false,
      message: 'Skipped due to quiet hours',
    };
  }

  // Generate digest
  const digest = await generateActivitySummary();

  if (!digest && !schedule.config.includeInactive) {
    // Update next run time even if we don't send
    schedule.lastRun = new Date().toISOString();
    schedule.nextRun = calculateNextRun(schedule.config).toISOString();
    saveStorage(storage);

    return { success: true, sent: false, message: 'No activity to report' };
  }

  const message = digest || 'No recent activity. All systems idle.';

  // Send notification
  const result = await sendNotification({
    type: 'custom',
    title: 'Scheduled Digest',
    message,
    prompt: {
      type: 'options',
      options: [
        { key: '1', label: 'Details', action: 'stackmemory status' },
        { key: '2', label: 'Tasks', action: 'stackmemory task list' },
      ],
    },
  });

  // Update schedule
  schedule.lastRun = new Date().toISOString();
  schedule.nextRun = calculateNextRun(schedule.config).toISOString();
  saveStorage(storage);

  if (result.success) {
    return {
      success: true,
      sent: true,
      message: `Digest sent (${message.length} chars)`,
    };
  } else {
    return { success: false, sent: false, error: result.error };
  }
}

/**
 * Check and run due schedules
 */
export async function checkAndRunDueSchedules(): Promise<{
  checked: number;
  ran: number;
  errors: number;
}> {
  const storage = loadStorage();
  const now = new Date();

  let ran = 0;
  let errors = 0;

  for (const schedule of storage.schedules) {
    if (!schedule.enabled || !schedule.nextRun) {
      continue;
    }

    const nextRun = new Date(schedule.nextRun);

    if (nextRun <= now) {
      console.log(`[whatsapp-scheduler] Running due schedule ${schedule.id}`);

      const result = await runScheduledDigest(schedule.id);

      if (result.success) {
        if (result.sent) {
          ran++;
        }
      } else {
        errors++;
        console.error(
          `[whatsapp-scheduler] Schedule ${schedule.id} failed: ${result.error}`
        );
      }
    }
  }

  // Update last checked
  storage.lastChecked = now.toISOString();
  saveStorage(storage);

  return { checked: storage.schedules.length, ran, errors };
}

/**
 * Start the scheduler daemon
 */
export function startScheduler(checkIntervalMs: number = 60000): void {
  if (schedulerInterval) {
    console.log('[whatsapp-scheduler] Scheduler already running');
    return;
  }

  console.log(
    `[whatsapp-scheduler] Starting scheduler (interval: ${checkIntervalMs}ms)`
  );

  // Run immediately
  checkAndRunDueSchedules().catch(console.error);

  // Then run on interval
  schedulerInterval = setInterval(() => {
    checkAndRunDueSchedules().catch(console.error);
  }, checkIntervalMs);
}

/**
 * Stop the scheduler daemon
 */
export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[whatsapp-scheduler] Scheduler stopped');
  }
}

/**
 * Check if scheduler is running
 */
export function isSchedulerRunning(): boolean {
  return schedulerInterval !== null;
}

/**
 * Create a daily schedule at specified time
 */
export function scheduleDailyDigest(time: string): string {
  const parsed = parseTime(time);
  if (!parsed) {
    throw new Error(
      `Invalid time format: ${time}. Use HH:MM format (e.g., 09:00)`
    );
  }

  return scheduleDigest({
    type: 'daily',
    time,
    includeInactive: false,
    quietHoursRespect: true,
  });
}

/**
 * Create an hourly schedule
 */
export function scheduleHourlyDigest(): string {
  return scheduleDigest({
    type: 'hourly',
    includeInactive: false,
    quietHoursRespect: true,
  });
}

/**
 * Create an interval-based schedule
 */
export function scheduleIntervalDigest(intervalMinutes: number): string {
  if (intervalMinutes < 5 || intervalMinutes > 1440) {
    throw new Error('Interval must be between 5 and 1440 minutes');
  }

  return scheduleDigest({
    type: 'interval',
    intervalMinutes,
    includeInactive: false,
    quietHoursRespect: true,
  });
}
