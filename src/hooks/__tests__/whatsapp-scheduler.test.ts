/**
 * Tests for WhatsApp Scheduled Digest Manager
 *
 * Tests scheduling, time parsing, quiet hours, and schedule CRUD operations.
 * Mocks filesystem and external dependencies to isolate unit behavior.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from 'vitest';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import {
  scheduleDigest,
  cancelSchedule,
  listSchedules,
  getSchedule,
  scheduleDailyDigest,
  scheduleHourlyDigest,
  scheduleIntervalDigest,
  checkAndRunDueSchedules,
  setScheduleEnabled,
  runScheduledDigest,
  type ScheduleConfig,
} from '../whatsapp-scheduler.js';

const SCHEDULE_PATH = join(
  homedir(),
  '.stackmemory',
  'whatsapp-schedules.json'
);
const SMS_CONFIG_PATH = join(homedir(), '.stackmemory', 'sms-notify.json');

let originalScheduleConfig: string | null = null;
let originalSMSConfig: string | null = null;

// Mock sendNotification to avoid actual network calls
vi.mock('../sms-notify.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sms-notify.js')>();
  return {
    ...actual,
    sendNotification: vi.fn().mockResolvedValue({ success: true, sent: true }),
    loadSMSConfig: vi.fn(() => ({
      enabled: true,
      channel: 'whatsapp',
      notifyOn: {
        taskComplete: true,
        reviewReady: true,
        error: true,
        custom: true,
        contextSync: true,
      },
      quietHours: {
        enabled: false,
        start: '22:00',
        end: '08:00',
      },
      responseTimeout: 300,
      pendingPrompts: [],
    })),
  };
});

// Mock whatsapp-sync to avoid real digest generation
vi.mock('../whatsapp-sync.js', () => ({
  getFrameDigestData: vi.fn().mockResolvedValue({
    frames: [],
    summary: 'Test summary',
  }),
  generateMobileDigest: vi.fn().mockReturnValue('Test digest content'),
  loadSyncOptions: vi.fn().mockReturnValue({
    autoSyncOnClose: false,
    minFrameDuration: 60,
    includeDecisions: true,
    includeFiles: true,
    includeTests: true,
    maxDigestLength: 500,
  }),
}));

describe('WhatsApp Scheduler', () => {
  beforeEach(() => {
    // Save original configs
    if (existsSync(SCHEDULE_PATH)) {
      originalScheduleConfig = readFileSync(SCHEDULE_PATH, 'utf8');
    }
    if (existsSync(SMS_CONFIG_PATH)) {
      originalSMSConfig = readFileSync(SMS_CONFIG_PATH, 'utf8');
    }

    // Create directory if needed
    mkdirSync(join(homedir(), '.stackmemory'), { recursive: true });

    // Write clean test schedules storage
    writeFileSync(
      SCHEDULE_PATH,
      JSON.stringify({
        schedules: [],
        lastChecked: new Date().toISOString(),
      })
    );

    // Write clean SMS config
    writeFileSync(
      SMS_CONFIG_PATH,
      JSON.stringify({
        enabled: true,
        channel: 'whatsapp',
        notifyOn: {
          taskComplete: true,
          reviewReady: true,
          error: true,
          custom: true,
          contextSync: true,
        },
        quietHours: {
          enabled: false,
          start: '22:00',
          end: '08:00',
        },
        responseTimeout: 300,
        pendingPrompts: [],
      })
    );

    // Clear mocks between tests
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original configs
    if (originalScheduleConfig) {
      writeFileSync(SCHEDULE_PATH, originalScheduleConfig);
    } else if (existsSync(SCHEDULE_PATH)) {
      unlinkSync(SCHEDULE_PATH);
    }
    originalScheduleConfig = null;

    if (originalSMSConfig) {
      writeFileSync(SMS_CONFIG_PATH, originalSMSConfig);
    } else if (existsSync(SMS_CONFIG_PATH)) {
      unlinkSync(SMS_CONFIG_PATH);
    }
    originalSMSConfig = null;
  });

  describe('parseTime', () => {
    // parseTime is internal but tested via scheduleDailyDigest
    it('should accept valid time formats and reject invalid ones', () => {
      // Valid times should not throw
      expect(() => scheduleDailyDigest('09:00')).not.toThrow();
      expect(() => scheduleDailyDigest('00:00')).not.toThrow();
      expect(() => scheduleDailyDigest('23:59')).not.toThrow();

      // Invalid formats
      expect(() => scheduleDailyDigest('9:00')).toThrow('Invalid time format');
      expect(() => scheduleDailyDigest('invalid')).toThrow(
        'Invalid time format'
      );
      expect(() => scheduleDailyDigest('')).toThrow('Invalid time format');

      // Out of range
      expect(() => scheduleDailyDigest('24:00')).toThrow('Invalid time format');
      expect(() => scheduleDailyDigest('09:60')).toThrow('Invalid time format');
    });
  });

  describe('calculateNextRun', () => {
    it('should calculate next run correctly for daily, hourly, and interval schedules', () => {
      // Daily schedule - 09:00
      const dailyId = scheduleDailyDigest('09:00');
      const dailySchedule = getSchedule(dailyId);
      expect(dailySchedule?.nextRun).toBeDefined();
      const dailyNextRun = new Date(dailySchedule!.nextRun!);
      expect(dailyNextRun.getHours()).toBe(9);
      expect(dailyNextRun.getMinutes()).toBe(0);

      // Hourly schedule - at top of next hour
      const hourlyId = scheduleHourlyDigest();
      const hourlyNextRun = new Date(getSchedule(hourlyId)!.nextRun!);
      expect(hourlyNextRun.getMinutes()).toBe(0);
      expect(hourlyNextRun.getHours()).toBe((new Date().getHours() + 1) % 24);

      // Interval schedule - 30 min from now
      const intervalId = scheduleIntervalDigest(30);
      const intervalNextRun = new Date(getSchedule(intervalId)!.nextRun!);
      const expectedTime = Date.now() + 30 * 60 * 1000;
      expect(Math.abs(intervalNextRun.getTime() - expectedTime)).toBeLessThan(
        1000
      );
    });
  });

  describe('isQuietHours', () => {
    // We need to import loadSMSConfig mock to test quiet hours
    let loadSMSConfigMock: MockInstance;

    beforeEach(async () => {
      const smsModule = await import('../sms-notify.js');
      loadSMSConfigMock = smsModule.loadSMSConfig as MockInstance;
    });

    it('should handle disabled, same-day, and overnight quiet hours scenarios', async () => {
      // Disabled quiet hours - schedules should be created
      loadSMSConfigMock.mockReturnValue({
        enabled: true,
        channel: 'whatsapp',
        notifyOn: {
          taskComplete: true,
          reviewReady: true,
          error: true,
          custom: true,
          contextSync: true,
        },
        quietHours: { enabled: false, start: '22:00', end: '08:00' },
        responseTimeout: 300,
        pendingPrompts: [],
      });
      const disabledId = scheduleDigest({
        type: 'interval',
        intervalMinutes: 5,
        includeInactive: false,
        quietHoursRespect: true,
      });
      expect(getSchedule(disabledId)).toBeDefined();

      // Same-day range (10:00-14:00) - verify checkAndRunDueSchedules works
      loadSMSConfigMock.mockReturnValue({
        enabled: true,
        channel: 'whatsapp',
        notifyOn: {
          taskComplete: true,
          reviewReady: true,
          error: true,
          custom: true,
          contextSync: true,
        },
        quietHours: { enabled: true, start: '10:00', end: '14:00' },
        responseTimeout: 300,
        pendingPrompts: [],
      });
      writeFileSync(
        SCHEDULE_PATH,
        JSON.stringify({
          schedules: [
            {
              id: 'test-quiet-1',
              config: {
                type: 'interval' as const,
                intervalMinutes: 5,
                includeInactive: false,
                quietHoursRespect: true,
              },
              enabled: true,
              nextRun: new Date(Date.now() - 60000).toISOString(),
              createdAt: new Date().toISOString(),
            },
          ],
          lastChecked: new Date().toISOString(),
        })
      );
      const result = await checkAndRunDueSchedules();
      expect(result).toHaveProperty('checked');
      expect(result).toHaveProperty('ran');
      expect(result).toHaveProperty('errors');

      // Overnight range (22:00-08:00) - schedules should still be created
      loadSMSConfigMock.mockReturnValue({
        enabled: true,
        channel: 'whatsapp',
        notifyOn: {
          taskComplete: true,
          reviewReady: true,
          error: true,
          custom: true,
          contextSync: true,
        },
        quietHours: { enabled: true, start: '22:00', end: '08:00' },
        responseTimeout: 300,
        pendingPrompts: [],
      });
      writeFileSync(
        SCHEDULE_PATH,
        JSON.stringify({ schedules: [], lastChecked: new Date().toISOString() })
      );
      const overnightId = scheduleDigest({
        type: 'interval',
        intervalMinutes: 5,
        includeInactive: false,
        quietHoursRespect: true,
      });
      expect(getSchedule(overnightId)).toBeDefined();
    });
  });

  describe('scheduleDigest / cancelSchedule', () => {
    it('should create schedules with id, persist to storage, and set nextRun', () => {
      const id = scheduleDigest({
        type: 'daily',
        time: '10:00',
        includeInactive: false,
        quietHoursRespect: true,
      });

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');

      // Persisted to storage
      const schedules = listSchedules();
      expect(schedules.length).toBe(1);
      expect(schedules[0].id).toBe(id);
      expect(schedules[0].enabled).toBe(true);

      // nextRun set
      expect(getSchedule(id)?.nextRun).toBeDefined();
    });

    it('should cancel existing schedules and return false for non-existent', () => {
      const id1 = scheduleDailyDigest('09:00');
      const id2 = scheduleHourlyDigest();
      expect(listSchedules().length).toBe(2);

      // Cancel one
      expect(cancelSchedule(id2)).toBe(true);
      expect(listSchedules().length).toBe(1);
      expect(listSchedules()[0].id).toBe(id1);

      // Non-existent
      expect(cancelSchedule('non-existent-id')).toBe(false);
    });
  });

  describe('listSchedules / getSchedule', () => {
    it('should list and retrieve schedules correctly', () => {
      // Empty initially
      expect(listSchedules()).toEqual([]);

      // Create schedules
      const id1 = scheduleDailyDigest('09:00');
      const id2 = scheduleHourlyDigest();
      expect(listSchedules().length).toBe(2);

      // Get specific schedule
      const schedule = getSchedule(id1);
      expect(schedule?.id).toBe(id1);
      expect(schedule?.config.type).toBe('daily');
      expect(schedule?.config.time).toBe('09:00');
      expect(schedule?.nextRun).toBeDefined();
      expect(schedule?.createdAt).toBeDefined();

      // Non-existent returns undefined
      expect(getSchedule('non-existent')).toBeUndefined();
    });
  });

  describe('schedule convenience functions', () => {
    it('should create daily, hourly, and interval schedules with correct defaults', () => {
      // Daily schedule
      const dailyId = scheduleDailyDigest('08:30');
      const dailySchedule = getSchedule(dailyId);
      expect(dailySchedule?.config.type).toBe('daily');
      expect(dailySchedule?.config.time).toBe('08:30');
      expect(dailySchedule?.config.quietHoursRespect).toBe(true);

      // Hourly schedule
      const hourlyId = scheduleHourlyDigest();
      expect(getSchedule(hourlyId)?.config.type).toBe('hourly');

      // Interval schedule
      const intervalId = scheduleIntervalDigest(120);
      const intervalSchedule = getSchedule(intervalId);
      expect(intervalSchedule?.config.type).toBe('interval');
      expect(intervalSchedule?.config.intervalMinutes).toBe(120);
    });

    it('should validate interval bounds', () => {
      expect(() => scheduleIntervalDigest(4)).toThrow(
        'Interval must be between 5 and 1440 minutes'
      );
      expect(() => scheduleIntervalDigest(1441)).toThrow(
        'Interval must be between 5 and 1440 minutes'
      );
      expect(() => scheduleIntervalDigest(5)).not.toThrow();
      expect(() => scheduleIntervalDigest(1440)).not.toThrow();
    });
  });

  describe('setScheduleEnabled', () => {
    it('should toggle schedule enabled state and recalculate nextRun', () => {
      const id = scheduleHourlyDigest();
      expect(getSchedule(id)?.enabled).toBe(true);

      // Disable
      expect(setScheduleEnabled(id, false)).toBe(true);
      expect(getSchedule(id)?.enabled).toBe(false);

      // Re-enable and verify nextRun is recalculated
      expect(setScheduleEnabled(id, true)).toBe(true);
      expect(getSchedule(id)?.enabled).toBe(true);
      expect(getSchedule(id)?.nextRun).toBeDefined();

      // Non-existent schedule
      expect(setScheduleEnabled('non-existent', true)).toBe(false);
    });
  });

  describe('checkAndRunDueSchedules', () => {
    let sendNotificationMock: MockInstance;

    beforeEach(async () => {
      const smsModule = await import('../sms-notify.js');
      sendNotificationMock = smsModule.sendNotification as MockInstance;
      sendNotificationMock.mockResolvedValue({ success: true, sent: true });
    });

    it('should return correct counts for empty, not-due, and disabled schedules', async () => {
      // No schedules
      let result = await checkAndRunDueSchedules();
      expect(result.checked).toBe(0);
      expect(result.ran).toBe(0);
      expect(result.errors).toBe(0);

      // Not due (60 min from now)
      scheduleIntervalDigest(60);
      result = await checkAndRunDueSchedules();
      expect(result.checked).toBe(1);
      expect(result.ran).toBe(0);
      expect(sendNotificationMock).not.toHaveBeenCalled();
    });

    it('should run due schedules', async () => {
      // Create a schedule that is already due
      const scheduleData = {
        schedules: [
          {
            id: 'due-schedule-1',
            config: {
              type: 'interval' as const,
              intervalMinutes: 30,
              includeInactive: true,
              quietHoursRespect: false,
            },
            enabled: true,
            nextRun: new Date(Date.now() - 60000).toISOString(), // 1 min ago
            createdAt: new Date().toISOString(),
          },
        ],
        lastChecked: new Date().toISOString(),
      };
      writeFileSync(SCHEDULE_PATH, JSON.stringify(scheduleData));

      const result = await checkAndRunDueSchedules();

      expect(result.checked).toBe(1);
      expect(result.ran).toBe(1);
      expect(sendNotificationMock).toHaveBeenCalled();
    });

    it('should skip disabled schedules and update lastChecked timestamp', async () => {
      const oldTime = new Date(Date.now() - 3600000).toISOString();
      const scheduleData = {
        schedules: [
          {
            id: 'disabled-schedule',
            config: {
              type: 'hourly' as const,
              includeInactive: false,
              quietHoursRespect: true,
            },
            enabled: false,
            nextRun: new Date(Date.now() - 60000).toISOString(),
            createdAt: new Date().toISOString(),
          },
        ],
        lastChecked: oldTime,
      };
      writeFileSync(SCHEDULE_PATH, JSON.stringify(scheduleData));

      const result = await checkAndRunDueSchedules();

      // Disabled schedule not run
      expect(result.checked).toBe(1);
      expect(result.ran).toBe(0);
      expect(sendNotificationMock).not.toHaveBeenCalled();

      // lastChecked updated
      const data = JSON.parse(readFileSync(SCHEDULE_PATH, 'utf8'));
      expect(new Date(data.lastChecked).getTime()).toBeGreaterThan(
        new Date(oldTime).getTime()
      );
    });

    it('should update schedule lastRun and nextRun after execution', async () => {
      // Create a schedule with includeInactive: true so it always runs
      // (mocked getFrameDigestData may return empty data)
      const id = scheduleDigest({
        type: 'interval',
        intervalMinutes: 30,
        includeInactive: true, // Always send, even with no activity
        quietHoursRespect: false,
      });
      const scheduleBefore = getSchedule(id);
      expect(scheduleBefore).toBeDefined();
      expect(scheduleBefore?.lastRun).toBeUndefined(); // No lastRun initially

      // Run the schedule directly (bypassing the due check)
      const result = await runScheduledDigest(id);

      // Verify execution succeeded
      expect(result.success).toBe(true);

      // Verify schedule was updated by reading the file directly
      // (avoids potential caching issues with getSchedule)
      const fileData = JSON.parse(readFileSync(SCHEDULE_PATH, 'utf8'));
      const scheduleAfter = fileData.schedules.find(
        (s: { id: string }) => s.id === id
      );
      expect(scheduleAfter).toBeDefined();
      expect(scheduleAfter.lastRun).toBeDefined();
      expect(scheduleAfter.nextRun).toBeDefined();
    });

    it('should handle multiple schedules with mixed due states', async () => {
      const scheduleData = {
        schedules: [
          {
            id: 'due-1',
            config: {
              type: 'interval' as const,
              intervalMinutes: 30,
              includeInactive: true,
              quietHoursRespect: false,
            },
            enabled: true,
            nextRun: new Date(Date.now() - 60000).toISOString(), // Due
            createdAt: new Date().toISOString(),
          },
          {
            id: 'not-due',
            config: {
              type: 'interval' as const,
              intervalMinutes: 60,
              includeInactive: false,
              quietHoursRespect: true,
            },
            enabled: true,
            nextRun: new Date(Date.now() + 3600000).toISOString(), // Not due
            createdAt: new Date().toISOString(),
          },
          {
            id: 'due-2',
            config: {
              type: 'hourly' as const,
              includeInactive: true,
              quietHoursRespect: false,
            },
            enabled: true,
            nextRun: new Date(Date.now() - 120000).toISOString(), // Due
            createdAt: new Date().toISOString(),
          },
        ],
        lastChecked: new Date().toISOString(),
      };
      writeFileSync(SCHEDULE_PATH, JSON.stringify(scheduleData));

      const result = await checkAndRunDueSchedules();

      expect(result.checked).toBe(3);
      expect(result.ran).toBe(2);
    });

    it('should count errors when notification fails', async () => {
      sendNotificationMock.mockResolvedValue({
        success: false,
        error: 'Network error',
      });

      const scheduleData = {
        schedules: [
          {
            id: 'error-schedule',
            config: {
              type: 'interval' as const,
              intervalMinutes: 30,
              includeInactive: true,
              quietHoursRespect: false,
            },
            enabled: true,
            nextRun: new Date(Date.now() - 60000).toISOString(),
            createdAt: new Date().toISOString(),
          },
        ],
        lastChecked: new Date().toISOString(),
      };
      writeFileSync(SCHEDULE_PATH, JSON.stringify(scheduleData));

      const result = await checkAndRunDueSchedules();

      expect(result.errors).toBe(1);
      expect(result.ran).toBe(0);
    });
  });

  describe('storage edge cases', () => {
    it('should handle missing, corrupted, or invalid storage gracefully', () => {
      // Missing file
      if (existsSync(SCHEDULE_PATH)) {
        unlinkSync(SCHEDULE_PATH);
      }
      expect(listSchedules()).toEqual([]);

      // Corrupted JSON
      writeFileSync(SCHEDULE_PATH, 'not valid json{{{');
      expect(listSchedules()).toEqual([]);

      // Invalid schema
      writeFileSync(
        SCHEDULE_PATH,
        JSON.stringify({ schedules: 'not-an-array' })
      );
      expect(listSchedules()).toEqual([]);
    });
  });
});
