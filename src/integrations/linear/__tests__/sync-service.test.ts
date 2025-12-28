/**
 * Tests for LinearSyncService - Bidirectional sync with Linear
 */

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { LinearSyncService, SyncResult } from '../sync-service.js';
import { LinearClient } from '../client.js';
import { ContextService } from '../../../services/context-service.js';
import { ConfigService } from '../../../services/config-service.js';
import { TaskStatus, TaskPriority, Task } from '../../../types/task.js';

// Mock dependencies
vi.mock('../client.js', () => ({
  LinearClient: vi.fn()
}));

vi.mock('../../../services/context-service.js', () => ({
  ContextService: vi.fn()
}));

vi.mock('../../../services/config-service.js', () => ({
  ConfigService: vi.fn()
}));

vi.mock('../../../utils/logger.js', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn()
  }))
}));

describe('LinearSyncService', () => {
  let syncService: LinearSyncService;
  let mockLinearClient: any;
  let mockContextService: any;
  let mockConfigService: any;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Store original environment
    originalEnv = process.env;
    
    // Set required environment variable
    process.env.LINEAR_API_KEY = 'test-api-key';

    // Setup mocks
    mockLinearClient = {
      getIssues: vi.fn(),
      updateIssue: vi.fn(),
      createIssue: vi.fn()
    };

    mockContextService = {
      getTaskByExternalId: vi.fn(),
      updateTask: vi.fn(),
      createTask: vi.fn(),
      getTask: vi.fn(),
      deleteTask: vi.fn(),
      getAllTasks: vi.fn()
    };

    mockConfigService = {
      getConfig: vi.fn()
    };

    // Configure mock constructors
    (LinearClient as Mock).mockImplementation(() => mockLinearClient);
    (ContextService as Mock).mockImplementation(() => mockContextService);
    (ConfigService as Mock).mockImplementation(() => mockConfigService);

    // Create sync service instance
    syncService = new LinearSyncService();
  });

  afterEach(() => {
    // Restore environment
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with Linear API key from environment', () => {
      expect(LinearClient).toHaveBeenCalledWith({ apiKey: 'test-api-key' });
    });

    it('should throw error when LINEAR_API_KEY is not set', () => {
      delete process.env.LINEAR_API_KEY;
      
      expect(() => {
        new LinearSyncService();
      }).toThrow('LINEAR_API_KEY environment variable not set');
    });

    it('should initialize services correctly', () => {
      expect(ContextService).toHaveBeenCalled();
      expect(ConfigService).toHaveBeenCalled();
    });
  });

  describe('syncAllIssues', () => {
    beforeEach(() => {
      mockConfigService.getConfig.mockResolvedValue({
        integrations: {
          linear: {
            teamId: 'test-team-id'
          }
        }
      });
    });

    it('should sync all issues from Linear successfully', async () => {
      const mockIssues = [
        {
          id: 'issue-1',
          identifier: 'STA-1',
          title: 'Test Issue 1',
          description: 'Description 1',
          state: { type: 'unstarted' },
          priority: 2,
          url: 'https://linear.app/issue-1',
          team: { id: 'team-1', key: 'STA' },
          labels: [{ name: 'bug' }],
          updatedAt: new Date().toISOString()
        },
        {
          id: 'issue-2',
          identifier: 'STA-2',
          title: 'Test Issue 2',
          description: 'Description 2',
          state: { type: 'completed' },
          priority: 3,
          url: 'https://linear.app/issue-2',
          team: { id: 'team-1', key: 'STA' },
          labels: [],
          updatedAt: new Date().toISOString()
        }
      ];

      mockLinearClient.getIssues.mockResolvedValue(mockIssues);
      mockContextService.getTaskByExternalId.mockResolvedValue(null); // No existing tasks

      const result = await syncService.syncAllIssues();

      expect(result.created).toBe(2);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(mockContextService.createTask).toHaveBeenCalledTimes(2);
    });

    it('should update existing tasks when they have changes', async () => {
      const mockIssue = {
        id: 'issue-1',
        identifier: 'STA-1',
        title: 'Updated Title',
        description: 'Updated Description',
        state: { type: 'completed' },
        priority: 3,
        url: 'https://linear.app/issue-1',
        team: { id: 'team-1', key: 'STA' },
        labels: [{ name: 'feature' }],
        updatedAt: new Date().toISOString()
      };

      const existingTask: Partial<Task> = {
        id: 'local-task-1',
        title: 'Old Title',
        description: 'Old Description',
        status: 'todo',
        priority: 'high',
        externalId: 'issue-1'
      };

      mockLinearClient.getIssues.mockResolvedValue([mockIssue]);
      mockContextService.getTaskByExternalId.mockResolvedValue(existingTask);

      const result = await syncService.syncAllIssues();

      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
      expect(mockContextService.updateTask).toHaveBeenCalledWith(
        'local-task-1',
        expect.objectContaining({
          title: 'Updated Title',
          description: 'Updated Description',
          status: 'done',
          priority: 'medium'
        })
      );
    });

    it('should skip tasks without changes', async () => {
      const mockIssue = {
        id: 'issue-1',
        identifier: 'STA-1',
        title: 'Same Title',
        description: 'Same Description',
        state: { type: 'unstarted' },
        priority: 2,
        url: 'https://linear.app/issue-1',
        team: { id: 'team-1', key: 'STA' },
        labels: [{ name: 'bug' }],
        updatedAt: new Date().toISOString()
      };

      const existingTask: Partial<Task> = {
        id: 'local-task-1',
        title: 'Same Title',
        description: 'Same Description',
        status: 'todo',
        priority: 'high',
        tags: ['bug'],
        externalId: 'issue-1'
      };

      mockLinearClient.getIssues.mockResolvedValue([mockIssue]);
      mockContextService.getTaskByExternalId.mockResolvedValue(existingTask);

      const result = await syncService.syncAllIssues();

      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(mockContextService.updateTask).not.toHaveBeenCalled();
    });

    it('should handle sync errors gracefully', async () => {
      const mockIssues = [
        {
          id: 'issue-1',
          identifier: 'STA-1',
          title: 'Test Issue',
          state: { type: 'unstarted' },
          team: { id: 'team-1', key: 'STA' },
          updatedAt: new Date().toISOString()
        }
      ];

      mockLinearClient.getIssues.mockResolvedValue(mockIssues);
      mockContextService.getTaskByExternalId.mockRejectedValue(new Error('Database error'));

      const result = await syncService.syncAllIssues();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Failed to sync STA-1');
    });

    it('should throw error when Linear team ID is not configured', async () => {
      mockConfigService.getConfig.mockResolvedValue({
        integrations: {}
      });

      const result = await syncService.syncAllIssues();

      expect(result.errors).toContain('Linear team ID not configured');
    });

    it('should handle Linear API errors', async () => {
      mockConfigService.getConfig.mockResolvedValue({
        integrations: {
          linear: { teamId: 'test-team-id' }
        }
      });

      mockLinearClient.getIssues.mockRejectedValue(new Error('Linear API error'));

      const result = await syncService.syncAllIssues();

      expect(result.errors).toContain('Linear API error');
    });
  });

  describe('syncIssueToLocal', () => {
    it('should create new local task from Linear issue', async () => {
      const mockIssue = {
        id: 'issue-1',
        identifier: 'STA-1',
        title: 'New Issue',
        description: 'Issue description',
        state: { type: 'unstarted', id: 'state-1', name: 'Todo' },
        priority: 1,
        url: 'https://linear.app/issue-1',
        team: { id: 'team-1', key: 'STA' },
        labels: [{ name: 'bug' }, { name: 'urgent' }],
        project: { id: 'proj-1', name: 'Main Project' },
        assignee: { id: 'user-1', name: 'John Doe' },
        updatedAt: new Date().toISOString()
      };

      mockContextService.getTaskByExternalId.mockResolvedValue(null);

      const result = await syncService.syncIssueToLocal(mockIssue);

      expect(result).toBe('created');
      expect(mockContextService.createTask).toHaveBeenCalledWith({
        title: 'New Issue',
        description: 'Issue description',
        status: 'todo',
        priority: 'urgent',
        externalId: 'issue-1',
        externalIdentifier: 'STA-1',
        externalUrl: 'https://linear.app/issue-1',
        tags: ['bug', 'urgent'],
        metadata: {
          linear: {
            teamId: 'team-1',
            teamKey: 'STA',
            stateId: 'state-1',
            stateName: 'Todo',
            projectId: 'proj-1',
            projectName: 'Main Project',
            assigneeId: 'user-1',
            assigneeName: 'John Doe'
          }
        },
        updatedAt: expect.any(Date)
      });
    });

    it('should update existing local task', async () => {
      const mockIssue = {
        id: 'issue-1',
        identifier: 'STA-1',
        title: 'Updated Issue',
        description: 'Updated description',
        state: { type: 'started', id: 'state-2', name: 'In Progress' },
        priority: 2,
        url: 'https://linear.app/issue-1',
        team: { id: 'team-1', key: 'STA' },
        labels: [{ name: 'feature' }],
        updatedAt: new Date().toISOString()
      };

      const existingTask: Task = {
        id: 'local-1',
        title: 'Old Title',
        description: 'Old description',
        status: 'todo',
        priority: 'low',
        tags: ['old-tag'],
        externalId: 'issue-1',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockContextService.getTaskByExternalId.mockResolvedValue(existingTask);

      const result = await syncService.syncIssueToLocal(mockIssue);

      expect(result).toBe('updated');
      expect(mockContextService.updateTask).toHaveBeenCalledWith('local-1', {
        title: 'Updated Issue',
        description: 'Updated description',
        status: 'in_progress',
        priority: 'high',
        externalId: 'issue-1',
        externalIdentifier: 'STA-1',
        externalUrl: 'https://linear.app/issue-1',
        tags: ['feature'],
        metadata: {
          linear: {
            teamId: 'team-1',
            teamKey: 'STA',
            stateId: 'state-2',
            stateName: 'In Progress',
            projectId: undefined,
            projectName: undefined,
            assigneeId: undefined,
            assigneeName: undefined
          }
        },
        updatedAt: expect.any(Date)
      });
    });

    it('should handle sync errors and rethrow', async () => {
      const mockIssue = {
        id: 'issue-1',
        identifier: 'STA-1',
        title: 'Error Issue',
        state: { type: 'unstarted' },
        team: { id: 'team-1', key: 'STA' },
        updatedAt: new Date().toISOString()
      };

      mockContextService.getTaskByExternalId.mockRejectedValue(new Error('Database error'));

      await expect(syncService.syncIssueToLocal(mockIssue)).rejects.toThrow('Database error');
    });
  });

  describe('syncLocalToLinear', () => {
    it('should create new Linear issue from local task', async () => {
      const mockTask: Task = {
        id: 'local-1',
        title: 'Local Task',
        description: 'Local description',
        status: 'todo',
        priority: 'high',
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const mockCreatedIssue = {
        id: 'issue-1',
        identifier: 'STA-1',
        title: 'Local Task',
        url: 'https://linear.app/issue-1'
      };

      mockContextService.getTask.mockResolvedValue(mockTask);
      mockLinearClient.createIssue.mockResolvedValue(mockCreatedIssue);

      const result = await syncService.syncLocalToLinear('local-1');

      expect(result).toEqual(mockCreatedIssue);
      expect(mockLinearClient.createIssue).toHaveBeenCalledWith({
        title: 'Local Task',
        description: 'Local description',
        priority: 3, // high -> 3
        stateId: undefined,
        projectId: undefined,
        assigneeId: undefined
      });
      expect(mockContextService.updateTask).toHaveBeenCalledWith('local-1', {
        externalId: 'issue-1'
      });
    });

    it('should update existing Linear issue', async () => {
      const mockTask: Task = {
        id: 'local-1',
        title: 'Updated Local Task',
        description: 'Updated description',
        status: 'in_progress',
        priority: 'medium',
        tags: [],
        externalId: 'issue-1',
        metadata: {
          linear: {
            stateId: 'state-1',
            projectId: 'proj-1',
            assigneeId: 'user-1'
          }
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const mockUpdatedIssue = {
        id: 'issue-1',
        identifier: 'STA-1',
        title: 'Updated Local Task'
      };

      mockContextService.getTask.mockResolvedValue(mockTask);
      mockLinearClient.updateIssue.mockResolvedValue(mockUpdatedIssue);

      const result = await syncService.syncLocalToLinear('local-1');

      expect(result).toEqual(mockUpdatedIssue);
      expect(mockLinearClient.updateIssue).toHaveBeenCalledWith('issue-1', {
        title: 'Updated Local Task',
        description: 'Updated description',
        priority: 2, // medium -> 2
        stateId: 'state-1',
        projectId: 'proj-1',
        assigneeId: 'user-1'
      });
    });

    it('should throw error for non-existent task', async () => {
      mockContextService.getTask.mockResolvedValue(null);

      await expect(syncService.syncLocalToLinear('non-existent')).rejects.toThrow('Task non-existent not found');
    });

    it('should handle Linear API errors', async () => {
      const mockTask: Task = {
        id: 'local-1',
        title: 'Task',
        description: 'Test task description',
        status: 'todo',
        priority: 'medium',
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockContextService.getTask.mockResolvedValue(mockTask);
      mockLinearClient.createIssue.mockRejectedValue(new Error('Linear API error'));

      await expect(syncService.syncLocalToLinear('local-1')).rejects.toThrow('Linear API error');
    });
  });

  describe('removeLocalIssue', () => {
    it('should remove local task by Linear identifier', async () => {
      const mockTasks: Task[] = [
        {
          id: 'local-1',
          title: 'Task 1',
          description: 'Task 1 description',
          status: 'todo',
          priority: 'medium',
          tags: [],
          externalIdentifier: 'STA-1',
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'local-2',
          title: 'Task 2',
          description: 'Task 2 description',
          status: 'todo',
          priority: 'medium',
          tags: [],
          externalIdentifier: 'STA-2',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      mockContextService.getAllTasks.mockResolvedValue(mockTasks);

      await syncService.removeLocalIssue('STA-1');

      expect(mockContextService.deleteTask).toHaveBeenCalledWith('local-1');
    });

    it('should handle non-existent identifier gracefully', async () => {
      mockContextService.getAllTasks.mockResolvedValue([]);

      await expect(syncService.removeLocalIssue('NON-EXISTENT')).resolves.not.toThrow();
      expect(mockContextService.deleteTask).not.toHaveBeenCalled();
    });

    it('should handle deletion errors', async () => {
      const mockTasks: Task[] = [{
        id: 'local-1',
        title: 'Task',
        description: 'Task description',
        status: 'todo',
        priority: 'medium',
        tags: [],
        externalIdentifier: 'STA-1',
        createdAt: new Date(),
        updatedAt: new Date()
      }];

      mockContextService.getAllTasks.mockResolvedValue(mockTasks);
      mockContextService.deleteTask.mockRejectedValue(new Error('Delete error'));

      await expect(syncService.removeLocalIssue('STA-1')).rejects.toThrow('Delete error');
    });
  });

  describe('Status and Priority Mapping', () => {
    it('should map Linear states to task statuses correctly', () => {
      const testCases = [
        { linearState: 'backlog', expectedStatus: 'todo' },
        { linearState: 'triage', expectedStatus: 'todo' },
        { linearState: 'unstarted', expectedStatus: 'todo' },
        { linearState: 'todo', expectedStatus: 'todo' },
        { linearState: 'started', expectedStatus: 'in_progress' },
        { linearState: 'in_progress', expectedStatus: 'in_progress' },
        { linearState: 'completed', expectedStatus: 'done' },
        { linearState: 'done', expectedStatus: 'done' },
        { linearState: 'canceled', expectedStatus: 'cancelled' },
        { linearState: 'cancelled', expectedStatus: 'cancelled' },
        { linearState: 'unknown', expectedStatus: 'todo' }
      ];

      testCases.forEach(({ linearState, expectedStatus }) => {
        const mockIssue = {
          id: 'test-issue',
          identifier: 'TEST-1',
          title: 'Test',
          state: { type: linearState },
          team: { id: 'team-1', key: 'TEST' },
          updatedAt: new Date().toISOString()
        };

        mockContextService.getTaskByExternalId.mockResolvedValue(null);

        syncService.syncIssueToLocal(mockIssue);

        expect(mockContextService.createTask).toHaveBeenCalledWith(
          expect.objectContaining({ status: expectedStatus })
        );

        vi.clearAllMocks();
      });
    });

    it('should map Linear priorities to task priorities correctly', () => {
      const testCases = [
        { linearPriority: 1, expectedPriority: 'urgent' },
        { linearPriority: 2, expectedPriority: 'high' },
        { linearPriority: 3, expectedPriority: 'medium' },
        { linearPriority: 4, expectedPriority: 'low' },
        { linearPriority: undefined, expectedPriority: undefined }
      ];

      testCases.forEach(({ linearPriority, expectedPriority }) => {
        const mockIssue = {
          id: 'test-issue',
          identifier: 'TEST-1',
          title: 'Test',
          state: { type: 'unstarted' },
          priority: linearPriority,
          team: { id: 'team-1', key: 'TEST' },
          updatedAt: new Date().toISOString()
        };

        mockContextService.getTaskByExternalId.mockResolvedValue(null);

        syncService.syncIssueToLocal(mockIssue);

        expect(mockContextService.createTask).toHaveBeenCalledWith(
          expect.objectContaining({ priority: expectedPriority })
        );

        vi.clearAllMocks();
      });
    });

    it('should map task priorities to Linear priorities correctly', () => {
      const testCases = [
        { taskPriority: 'urgent' as TaskPriority, expectedLinearPriority: 4 },
        { taskPriority: 'high' as TaskPriority, expectedLinearPriority: 3 },
        { taskPriority: 'medium' as TaskPriority, expectedLinearPriority: 2 },
        { taskPriority: 'low' as TaskPriority, expectedLinearPriority: 1 },
        { taskPriority: undefined, expectedLinearPriority: 0 }
      ];

      testCases.forEach(({ taskPriority, expectedLinearPriority }) => {
        const mockTask: Task = {
          id: 'local-1',
          title: 'Test Task',
          description: 'Test description',
          status: 'todo',
          priority: taskPriority,
          tags: [],
          createdAt: new Date(),
          updatedAt: new Date()
        };

        mockContextService.getTask.mockResolvedValue(mockTask);
        mockLinearClient.createIssue.mockResolvedValue({ id: 'created', identifier: 'TEST-1' });

        syncService.syncLocalToLinear('local-1');

        expect(mockLinearClient.createIssue).toHaveBeenCalledWith(
          expect.objectContaining({ priority: expectedLinearPriority })
        );

        vi.clearAllMocks();
      });
    });
  });

  describe('Change Detection', () => {
    it('should detect changes in title', () => {
      const existing: Task = {
        id: '1',
        title: 'Old Title',
        description: 'Same',
        status: 'todo',
        priority: 'medium',
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const updated: Partial<Task> = {
        title: 'New Title',
        description: 'Same',
        status: 'todo',
        priority: 'medium',
        tags: []
      };

      mockContextService.getTaskByExternalId.mockResolvedValue(existing);

      const mockIssue = {
        id: 'issue-1',
        identifier: 'STA-1',
        title: 'New Title',
        description: 'Same',
        state: { type: 'unstarted' },
        priority: 2,
        team: { id: 'team-1', key: 'STA' },
        labels: [],
        updatedAt: new Date().toISOString()
      };

      syncService.syncIssueToLocal(mockIssue);

      expect(mockContextService.updateTask).toHaveBeenCalled();
    });

    it('should detect changes in tags', () => {
      const existing: Task = {
        id: '1',
        title: 'Same',
        description: 'Same',
        status: 'todo',
        priority: 'medium',
        tags: ['old-tag'],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockContextService.getTaskByExternalId.mockResolvedValue(existing);

      const mockIssue = {
        id: 'issue-1',
        identifier: 'STA-1',
        title: 'Same',
        description: 'Same',
        state: { type: 'unstarted' },
        priority: 2,
        team: { id: 'team-1', key: 'STA' },
        labels: [{ name: 'new-tag' }],
        updatedAt: new Date().toISOString()
      };

      syncService.syncIssueToLocal(mockIssue);

      expect(mockContextService.updateTask).toHaveBeenCalled();
    });

    it('should not update when no changes detected', () => {
      const existing: Task = {
        id: '1',
        title: 'Same Title',
        description: 'Same Description',
        status: 'todo',
        priority: 'medium',
        tags: ['tag1'],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockContextService.getTaskByExternalId.mockResolvedValue(existing);

      const mockIssue = {
        id: 'issue-1',
        identifier: 'STA-1',
        title: 'Same Title',
        description: 'Same Description',
        state: { type: 'unstarted' },
        priority: 2,
        team: { id: 'team-1', key: 'STA' },
        labels: [{ name: 'tag1' }],
        updatedAt: new Date().toISOString()
      };

      syncService.syncIssueToLocal(mockIssue);

      expect(mockContextService.updateTask).not.toHaveBeenCalled();
    });
  });

  describe('Error Recovery and Edge Cases', () => {
    it('should handle partial sync failures gracefully', async () => {
      const mockIssues = [
        { id: 'issue-1', identifier: 'STA-1', title: 'Good Issue', state: { type: 'unstarted' }, team: { id: 'team-1', key: 'STA' }, updatedAt: new Date().toISOString() },
        { id: 'issue-2', identifier: 'STA-2', title: 'Bad Issue', state: { type: 'unstarted' }, team: { id: 'team-1', key: 'STA' }, updatedAt: new Date().toISOString() }
      ];

      mockConfigService.getConfig.mockResolvedValue({
        integrations: { linear: { teamId: 'test-team-id' } }
      });
      
      mockLinearClient.getIssues.mockResolvedValue(mockIssues);
      mockContextService.getTaskByExternalId.mockResolvedValue(null);
      
      // First issue succeeds, second fails
      mockContextService.createTask
        .mockResolvedValueOnce('success')
        .mockRejectedValueOnce(new Error('Creation failed'));

      const result = await syncService.syncAllIssues();

      expect(result.created).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Failed to sync STA-2');
    });

    it('should handle empty issues list', async () => {
      mockConfigService.getConfig.mockResolvedValue({
        integrations: { linear: { teamId: 'test-team-id' } }
      });
      
      mockLinearClient.getIssues.mockResolvedValue([]);

      const result = await syncService.syncAllIssues();

      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle malformed Linear issues', async () => {
      const malformedIssue = {
        // Missing required fields
        id: 'issue-1',
        title: null,
        state: null,
        team: null
      };

      mockConfigService.getConfig.mockResolvedValue({
        integrations: { linear: { teamId: 'test-team-id' } }
      });
      
      mockLinearClient.getIssues.mockResolvedValue([malformedIssue]);

      const result = await syncService.syncAllIssues();

      expect(result.errors).toHaveLength(1);
    });

    it('should handle network timeouts gracefully', async () => {
      mockConfigService.getConfig.mockResolvedValue({
        integrations: { linear: { teamId: 'test-team-id' } }
      });

      const timeoutError = new Error('Request timeout');
      timeoutError.name = 'TimeoutError';
      
      mockLinearClient.getIssues.mockRejectedValue(timeoutError);

      const result = await syncService.syncAllIssues();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Request timeout');
    });
  });
});