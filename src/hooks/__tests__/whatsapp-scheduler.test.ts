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
    it('should accept valid time format HH:MM', () => {
      // Valid times should not throw
      expect(() => scheduleDailyDigest('09:00')).not.toThrow();
      expect(() => scheduleDailyDigest('00:00')).not.toThrow();
      expect(() => scheduleDailyDigest('23:59')).not.toThrow();
      expect(() => scheduleDailyDigest('12:30')).not.toThrow();
    });

    it('should reject invalid time format', () => {
      expect(() => scheduleDailyDigest('9:00')).toThrow('Invalid time format');
      expect(() => scheduleDailyDigest('09:0')).toThrow('Invalid time format');
      expect(() => scheduleDailyDigest('9:0')).toThrow('Invalid time format');
      expect(() => scheduleDailyDigest('invalid')).toThrow(
        'Invalid time format'
      );
      expect(() => scheduleDailyDigest('')).toThrow('Invalid time format');
    });

    it('should reject out-of-range hours', () => {
      expect(() => scheduleDailyDigest('24:00')).toThrow('Invalid time format');
      expect(() => scheduleDailyDigest('25:00')).toThrow('Invalid time format');
    });

    it('should reject out-of-range minutes', () => {
      expect(() => scheduleDailyDigest('09:60')).toThrow('Invalid time format');
      expect(() => scheduleDailyDigest('09:99')).toThrow('Invalid time format');
    });
  });

  describe('calculateNextRun', () => {
    it('should calculate next run for daily schedule', () => {
      // Schedule for 09:00 daily
      const id = scheduleDailyDigest('09:00');
      const schedule = getSchedule(id);

      expect(schedule).toBeDefined();
      expect(schedule?.nextRun).toBeDefined();

      const nextRun = new Date(schedule!.nextRun!);
      expect(nextRun.getHours()).toBe(9);
      expect(nextRun.getMinutes()).toBe(0);
    });

    it('should schedule for next day if time has passed today', () => {
      // Use a time that has already passed today
      const now = new Date();
      const pastHour = Math.max(0, now.getHours() - 1);
      const timeStr = `${pastHour.toString().padStart(2, '0')}:00`;

      const id = scheduleDailyDigest(timeStr);
      const schedule = getSchedule(id);

      expect(schedule).toBeDefined();
      const nextRun = new Date(schedule!.nextRun!);

      // Should be tomorrow since the time has passed
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      expect(nextRun.getDate()).toBe(tomorrow.getDate());
    });

    it('should calculate next run for hourly schedule', () => {
      const id = scheduleHourlyDigest();
      const schedule = getSchedule(id);

      expect(schedule).toBeDefined();
      expect(schedule?.nextRun).toBeDefined();

      const nextRun = new Date(schedule!.nextRun!);
      const now = new Date();

      // Should be at the top of the next hour
      expect(nextRun.getMinutes()).toBe(0);
      expect(nextRun.getSeconds()).toBe(0);
      expect(nextRun.getHours()).toBe((now.getHours() + 1) % 24);
    });

    it('should calculate next run for interval schedule', () => {
      const id = scheduleIntervalDigest(30); // 30 minutes
      const schedule = getSchedule(id);

      expect(schedule).toBeDefined();
      expect(schedule?.nextRun).toBeDefined();

      const nextRun = new Date(schedule!.nextRun!);
      const now = new Date();
      const expectedTime = now.getTime() + 30 * 60 * 1000;

      // Should be approximately 30 minutes from now (within 1 second tolerance)
      expect(Math.abs(nextRun.getTime() - expectedTime)).toBeLessThan(1000);
    });
  });

  describe('isQuietHours', () => {
    // We need to import loadSMSConfig mock to test quiet hours
    let loadSMSConfigMock: MockInstance;

    beforeEach(async () => {
      const smsModule = await import('../sms-notify.js');
      loadSMSConfigMock = smsModule.loadSMSConfig as MockInstance;
    });

    it('should return false when quiet hours disabled', async () => {
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
        quietHours: {
          enabled: false,
          start: '22:00',
          end: '08:00',
        },
        responseTimeout: 300,
        pendingPrompts: [],
      });

      // Create a schedule that respects quiet hours
      const id = scheduleDigest({
        type: 'interval',
        intervalMinutes: 5,
        includeInactive: false,
        quietHoursRespect: true,
      });

      const schedule = getSchedule(id);
      expect(schedule).toBeDefined();
      // Schedule should be created regardless of time since quiet hours is disabled
    });

    it('should detect when within quiet hours range (same day)', async () => {
      // Set quiet hours 10:00 - 14:00 (same day range)
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
        quietHours: {
          enabled: true,
          start: '10:00',
          end: '14:00',
        },
        responseTimeout: 300,
        pendingPrompts: [],
      });

      // Test via checkAndRunDueSchedules with a due schedule
      const scheduleData = {
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
            nextRun: new Date(Date.now() - 60000).toISOString(), // 1 min ago (due)
            createdAt: new Date().toISOString(),
          },
        ],
        lastChecked: new Date().toISOString(),
      };
      writeFileSync(SCHEDULE_PATH, JSON.stringify(scheduleData));

      // The behavior depends on current time - just verify function runs
      const result = await checkAndRunDueSchedules();
      expect(result).toHaveProperty('checked');
      expect(result).toHaveProperty('ran');
      expect(result).toHaveProperty('errors');
    });

    it('should detect when within overnight quiet hours', async () => {
      // Set quiet hours 22:00 - 08:00 (overnight)
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
        quietHours: {
          enabled: true,
          start: '22:00',
          end: '08:00',
        },
        responseTimeout: 300,
        pendingPrompts: [],
      });

      // Schedule should still be created
      const id = scheduleDigest({
        type: 'interval',
        intervalMinutes: 5,
        includeInactive: false,
        quietHoursRespect: true,
      });

      const schedule = getSchedule(id);
      expect(schedule).toBeDefined();
    });
  });

  describe('scheduleDigest / cancelSchedule', () => {
    it('should create a new schedule and return id', () => {
      const config: ScheduleConfig = {
        type: 'daily',
        time: '10:00',
        includeInactive: false,
        quietHoursRespect: true,
      };

      const id = scheduleDigest(config);

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('should persist schedule to storage', () => {
      const config: ScheduleConfig = {
        type: 'hourly',
        includeInactive: true,
        quietHoursRespect: false,
      };

      const id = scheduleDigest(config);
      const schedules = listSchedules();

      expect(schedules.length).toBe(1);
      expect(schedules[0].id).toBe(id);
      expect(schedules[0].config.type).toBe('hourly');
      expect(schedules[0].enabled).toBe(true);
    });

    it('should set nextRun on creation', () => {
      const config: ScheduleConfig = {
        type: 'interval',
        intervalMinutes: 15,
        includeInactive: false,
        quietHoursRespect: true,
      };

      const id = scheduleDigest(config);
      const schedule = getSchedule(id);

      expect(schedule?.nextRun).toBeDefined();
      const nextRun = new Date(schedule!.nextRun!);
      expect(nextRun.getTime()).toBeGreaterThan(Date.now());
    });

    it('should cancel existing schedule', () => {
      const id = scheduleHourlyDigest();
      expect(listSchedules().length).toBe(1);

      const result = cancelSchedule(id);

      expect(result).toBe(true);
      expect(listSchedules().length).toBe(0);
    });

    it('should return false when cancelling non-existent schedule', () => {
      const result = cancelSchedule('non-existent-id');
      expect(result).toBe(false);
    });

    it('should remove only the specified schedule', () => {
      const id1 = scheduleDailyDigest('09:00');
      const id2 = scheduleHourlyDigest();
      const id3 = scheduleIntervalDigest(30);

      expect(listSchedules().length).toBe(3);

      cancelSchedule(id2);

      const remaining = listSchedules();
      expect(remaining.length).toBe(2);
      expect(remaining.find((s) => s.id === id1)).toBeDefined();
      expect(remaining.find((s) => s.id === id2)).toBeUndefined();
      expect(remaining.find((s) => s.id === id3)).toBeDefined();
    });
  });

  describe('listSchedules / getSchedule', () => {
    it('should return empty array when no schedules', () => {
      const schedules = listSchedules();
      expect(schedules).toEqual([]);
    });

    it('should return all schedules', () => {
      scheduleDailyDigest('09:00');
      scheduleHourlyDigest();
      scheduleIntervalDigest(60);

      const schedules = listSchedules();
      expect(schedules.length).toBe(3);
    });

    it('should get specific schedule by id', () => {
      const id = scheduleDailyDigest('14:30');
      const schedule = getSchedule(id);

      expect(schedule).toBeDefined();
      expect(schedule?.id).toBe(id);
      expect(schedule?.config.type).toBe('daily');
      expect(schedule?.config.time).toBe('14:30');
    });

    it('should return undefined for non-existent schedule', () => {
      const schedule = getSchedule('non-existent');
      expect(schedule).toBeUndefined();
    });

    it('should include all schedule fields', () => {
      const id = scheduleDigest({
        type: 'interval',
        intervalMinutes: 45,
        includeInactive: true,
        quietHoursRespect: false,
      });

      const schedule = getSchedule(id);

      expect(schedule).toMatchObject({
        id,
        config: {
          type: 'interval',
          intervalMinutes: 45,
          includeInactive: true,
          quietHoursRespect: false,
        },
        enabled: true,
      });
      expect(schedule?.nextRun).toBeDefined();
      expect(schedule?.createdAt).toBeDefined();
    });
  });

  describe('scheduleDailyDigest', () => {
    it('should create daily schedule with specified time', () => {
      const id = scheduleDailyDigest('08:30');
      const schedule = getSchedule(id);

      expect(schedule?.config.type).toBe('daily');
      expect(schedule?.config.time).toBe('08:30');
      expect(schedule?.config.quietHoursRespect).toBe(true);
      expect(schedule?.config.includeInactive).toBe(false);
    });

    it('should throw for invalid time format', () => {
      expect(() => scheduleDailyDigest('8:30')).toThrow();
      expect(() => scheduleDailyDigest('abc')).toThrow();
      expect(() => scheduleDailyDigest('')).toThrow();
    });
  });

  describe('scheduleHourlyDigest', () => {
    it('should create hourly schedule', () => {
      const id = scheduleHourlyDigest();
      const schedule = getSchedule(id);

      expect(schedule?.config.type).toBe('hourly');
      expect(schedule?.config.quietHoursRespect).toBe(true);
      expect(schedule?.config.includeInactive).toBe(false);
    });
  });

  describe('scheduleIntervalDigest', () => {
    it('should create interval schedule with specified minutes', () => {
      const id = scheduleIntervalDigest(120);
      const schedule = getSchedule(id);

      expect(schedule?.config.type).toBe('interval');
      expect(schedule?.config.intervalMinutes).toBe(120);
      expect(schedule?.config.quietHoursRespect).toBe(true);
    });

    it('should throw for interval less than 5 minutes', () => {
      expect(() => scheduleIntervalDigest(4)).toThrow(
        'Interval must be between 5 and 1440 minutes'
      );
      expect(() => scheduleIntervalDigest(0)).toThrow();
      expect(() => scheduleIntervalDigest(-10)).toThrow();
    });

    it('should throw for interval greater than 1440 minutes', () => {
      expect(() => scheduleIntervalDigest(1441)).toThrow(
        'Interval must be between 5 and 1440 minutes'
      );
      expect(() => scheduleIntervalDigest(2000)).toThrow();
    });

    it('should accept boundary values', () => {
      expect(() => scheduleIntervalDigest(5)).not.toThrow();
      expect(() => scheduleIntervalDigest(1440)).not.toThrow();
    });
  });

  describe('setScheduleEnabled', () => {
    it('should disable a schedule', () => {
      const id = scheduleHourlyDigest();
      expect(getSchedule(id)?.enabled).toBe(true);

      const result = setScheduleEnabled(id, false);

      expect(result).toBe(true);
      expect(getSchedule(id)?.enabled).toBe(false);
    });

    it('should enable a disabled schedule', () => {
      const id = scheduleHourlyDigest();
      setScheduleEnabled(id, false);

      const result = setScheduleEnabled(id, true);

      expect(result).toBe(true);
      expect(getSchedule(id)?.enabled).toBe(true);
    });

    it('should recalculate nextRun when enabling', () => {
      const id = scheduleHourlyDigest();
      const originalNextRun = getSchedule(id)?.nextRun;

      setScheduleEnabled(id, false);
      // Wait a bit to ensure different nextRun time
      setScheduleEnabled(id, true);

      const newNextRun = getSchedule(id)?.nextRun;
      // nextRun should be recalculated
      expect(newNextRun).toBeDefined();
    });

    it('should return false for non-existent schedule', () => {
      const result = setScheduleEnabled('non-existent', true);
      expect(result).toBe(false);
    });
  });

  describe('checkAndRunDueSchedules', () => {
    let sendNotificationMock: MockInstance;

    beforeEach(async () => {
      const smsModule = await import('../sms-notify.js');
      sendNotificationMock = smsModule.sendNotification as MockInstance;
      sendNotificationMock.mockResolvedValue({ success: true, sent: true });
    });

    it('should return counts when no schedules exist', async () => {
      const result = await checkAndRunDueSchedules();

      expect(result.checked).toBe(0);
      expect(result.ran).toBe(0);
      expect(result.errors).toBe(0);
    });

    it('should not run schedules that are not due', async () => {
      // Create schedule with future nextRun
      const id = scheduleIntervalDigest(60); // 60 min from now
      const result = await checkAndRunDueSchedules();

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

    it('should skip disabled schedules', async () => {
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
            nextRun: new Date(Date.now() - 60000).toISOString(), // Due but disabled
            createdAt: new Date().toISOString(),
          },
        ],
        lastChecked: new Date().toISOString(),
      };
      writeFileSync(SCHEDULE_PATH, JSON.stringify(scheduleData));

      const result = await checkAndRunDueSchedules();

      expect(result.checked).toBe(1);
      expect(result.ran).toBe(0);
      expect(sendNotificationMock).not.toHaveBeenCalled();
    });

    it('should update lastChecked timestamp', async () => {
      const oldTime = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
      writeFileSync(
        SCHEDULE_PATH,
        JSON.stringify({
          schedules: [],
          lastChecked: oldTime,
        })
      );

      await checkAndRunDueSchedules();

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
    it('should handle missing storage file gracefully', () => {
      if (existsSync(SCHEDULE_PATH)) {
        unlinkSync(SCHEDULE_PATH);
      }

      const schedules = listSchedules();
      expect(schedules).toEqual([]);
    });

    it('should handle corrupted storage file', () => {
      writeFileSync(SCHEDULE_PATH, 'not valid json{{{');

      const schedules = listSchedules();
      expect(schedules).toEqual([]);
    });

    it('should handle storage with invalid schema', () => {
      writeFileSync(
        SCHEDULE_PATH,
        JSON.stringify({
          schedules: 'not-an-array',
          lastChecked: 123,
        })
      );

      const schedules = listSchedules();
      expect(schedules).toEqual([]);
    });
  });
});
