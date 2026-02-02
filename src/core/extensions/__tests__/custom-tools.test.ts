/**
 * Tests for Custom Tools Framework
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ToolRegistry,
  createToolRegistry,
  defineTool,
  type ToolDefinition,
  type JSONSchema,
} from '../custom-tools.js';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = createToolRegistry();
  });

  describe('registration', () => {
    it('should register a valid tool', () => {
      const tool = createValidTool('test_tool');
      const id = registry.register(tool);

      expect(id).toBeDefined();
      expect(registry.has('test_tool')).toBe(true);
      expect(registry.size).toBe(1);
    });

    it('should reject duplicate tool names', () => {
      const tool = createValidTool('duplicate_tool');
      registry.register(tool);

      expect(() => registry.register(tool)).toThrow('already registered');
    });

    it('should reject invalid tool names', () => {
      const invalidNames = [
        'ab', // too short
        'A_UPPER', // uppercase
        '123start', // starts with number
        'has-dash', // contains dash
        'has space', // contains space
      ];

      for (const name of invalidNames) {
        const tool = createValidTool(name);
        expect(() => registry.register(tool)).toThrow();
      }
    });

    it('should accept valid tool names', () => {
      const validNames = ['abc', 'test_tool', 'my_tool_123', 'a1b2c3'];

      for (const name of validNames) {
        const tool = createValidTool(name);
        expect(() => registry.register(tool)).not.toThrow();
      }
    });

    it('should reject short descriptions', () => {
      const tool: ToolDefinition = {
        name: 'short_desc',
        description: 'Short', // less than 10 chars
        parameters: { type: 'object' },
        execute: async () => ({ success: true }),
      };

      expect(() => registry.register(tool)).toThrow('at least 10 characters');
    });

    it('should reject invalid parameter schemas', () => {
      const tool: ToolDefinition = {
        name: 'bad_schema',
        description: 'A tool with an invalid parameter schema',
        parameters: { type: 'string' } as unknown as JSONSchema, // must be 'object'
        execute: async () => ({ success: true }),
      };

      expect(() => registry.register(tool)).toThrow();
    });
  });

  describe('discovery', () => {
    beforeEach(() => {
      registry.register(createValidTool('tool_one', { category: 'utils' }));
      registry.register(
        createValidTool('tool_two', { category: 'utils', tags: ['async'] })
      );
      registry.register(
        createValidTool('tool_three', {
          category: 'data',
          tags: ['async', 'io'],
        })
      );
    });

    it('should get tool by name', () => {
      const tool = registry.get('tool_one');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('tool_one');
    });

    it('should return undefined for unknown tool', () => {
      expect(registry.get('unknown')).toBeUndefined();
    });

    it('should list all tools', () => {
      const tools = registry.list();
      expect(tools).toHaveLength(3);
    });

    it('should filter by category', () => {
      const tools = registry.list({ category: 'utils' });
      expect(tools).toHaveLength(2);
    });

    it('should filter by tags', () => {
      const tools = registry.list({ tags: ['async'] });
      expect(tools).toHaveLength(2);
    });

    it('should filter by enabled status', () => {
      registry.setEnabled('tool_one', false);
      const enabled = registry.list({ enabled: true });
      const disabled = registry.list({ enabled: false });

      expect(enabled).toHaveLength(2);
      expect(disabled).toHaveLength(1);
    });

    it('should get MCP tool definitions', () => {
      const mcpTools = registry.getMCPToolDefinitions();
      expect(mcpTools).toHaveLength(3);
      expect(mcpTools[0]).toHaveProperty('name');
      expect(mcpTools[0]).toHaveProperty('description');
      expect(mcpTools[0]).toHaveProperty('inputSchema');
    });
  });

  describe('execution', () => {
    it('should execute a tool successfully', async () => {
      const tool = defineTool(
        'echo_tool',
        'A tool that echoes its input',
        {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
          required: ['message'],
        },
        async (params) => {
          const p = params as { message: string };
          return { success: true, data: p.message };
        }
      );

      registry.register(tool);
      const result = await registry.execute('echo_tool', { message: 'hello' });

      expect(result.success).toBe(true);
      expect(result.data).toBe('hello');
    });

    it('should return error for unknown tool', async () => {
      const result = await registry.execute('unknown_tool', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error for disabled tool', async () => {
      registry.register(createValidTool('disabled_tool'));
      registry.setEnabled('disabled_tool', false);

      const result = await registry.execute('disabled_tool', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');
    });

    it('should validate required parameters', async () => {
      const tool = defineTool(
        'required_params',
        'A tool with required parameters',
        {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
          required: ['name'],
        },
        async () => ({ success: true })
      );

      registry.register(tool);
      const result = await registry.execute('required_params', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required');
    });

    it('should validate parameter types', async () => {
      const tool = defineTool(
        'typed_params',
        'A tool with typed parameters',
        {
          type: 'object',
          properties: {
            count: { type: 'number', minimum: 0 },
          },
        },
        async () => ({ success: true })
      );

      registry.register(tool);
      const result = await registry.execute('typed_params', {
        count: 'not a number',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('must be of type number');
    });

    it('should validate number ranges', async () => {
      const tool = defineTool(
        'range_params',
        'A tool with range validation',
        {
          type: 'object',
          properties: {
            value: { type: 'number', minimum: 0, maximum: 100 },
          },
        },
        async () => ({ success: true })
      );

      registry.register(tool);

      const tooLow = await registry.execute('range_params', { value: -1 });
      expect(tooLow.success).toBe(false);
      expect(tooLow.error).toContain('at least 0');

      const tooHigh = await registry.execute('range_params', { value: 101 });
      expect(tooHigh.success).toBe(false);
      expect(tooHigh.error).toContain('at most 100');
    });

    it('should validate string enum values', async () => {
      const tool = defineTool(
        'enum_params',
        'A tool with enum validation',
        {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['active', 'inactive'] },
          },
        },
        async () => ({ success: true })
      );

      registry.register(tool);
      const result = await registry.execute('enum_params', {
        status: 'unknown',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('must be one of');
    });

    it('should catch execution errors', async () => {
      const tool = defineTool(
        'error_tool',
        'A tool that throws an error',
        { type: 'object' },
        async () => {
          throw new Error('Something went wrong');
        }
      );

      registry.register(tool);
      const result = await registry.execute('error_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Something went wrong');
    });

    it('should handle timeout', async () => {
      const tool = defineTool(
        'slow_tool',
        'A tool that takes too long',
        { type: 'object' },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          return { success: true };
        },
        { timeout: 100 }
      );

      registry.register(tool);
      const result = await registry.execute('slow_tool', {}, { timeout: 100 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });

    it('should track usage statistics', async () => {
      registry.register(createValidTool('stats_tool'));

      await registry.execute('stats_tool', {});
      await registry.execute('stats_tool', {});

      const tool = registry.get('stats_tool');
      expect(tool?.usageCount).toBe(2);
      expect(tool?.lastUsedAt).toBeDefined();
    });
  });

  describe('extension context', () => {
    it('should provide storage to tools', async () => {
      const tool = defineTool(
        'storage_tool',
        'A tool that uses storage',
        { type: 'object' },
        async (_params, context) => {
          await context.storage.set('key', 'value');
          const retrieved = await context.storage.get('key');
          return { success: true, data: retrieved };
        }
      );

      registry.register(tool);
      const result = await registry.execute('storage_tool', {});

      expect(result.success).toBe(true);
      expect(result.data).toBe('value');
    });

    it('should provide event emitter to tools', async () => {
      const events: unknown[] = [];

      const tool = defineTool(
        'event_tool',
        'A tool that emits events',
        { type: 'object' },
        async (_params, context) => {
          context.on('test_event', (data) => events.push(data));
          context.emit('test_event', { message: 'hello' });
          return { success: true };
        }
      );

      registry.register(tool);
      await registry.execute('event_tool', {});

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ message: 'hello' });
    });

    it('should provide sandboxed logging', async () => {
      const tool = defineTool(
        'log_tool',
        'A tool that logs messages',
        { type: 'object' },
        async (_params, context) => {
          context.log.info('Info message');
          context.log.warn('Warning message');
          context.log.error('Error message');
          return { success: true };
        }
      );

      registry.register(tool);
      const result = await registry.execute('log_tool', {});

      expect(result.success).toBe(true);
    });
  });

  describe('management', () => {
    it('should unregister a tool', () => {
      registry.register(createValidTool('to_remove'));
      expect(registry.has('to_remove')).toBe(true);

      const removed = registry.unregister('to_remove');
      expect(removed).toBe(true);
      expect(registry.has('to_remove')).toBe(false);
    });

    it('should return false for unregistering unknown tool', () => {
      expect(registry.unregister('unknown')).toBe(false);
    });

    it('should update tool definition', () => {
      registry.register(createValidTool('update_me'));
      const updated = registry.update('update_me', {
        description: 'Updated description for the tool',
      });

      expect(updated).toBe(true);
      expect(registry.get('update_me')?.description).toBe(
        'Updated description for the tool'
      );
    });

    it('should enable and disable tools', () => {
      registry.register(createValidTool('toggle_tool'));

      registry.setEnabled('toggle_tool', false);
      expect(registry.get('toggle_tool')?.enabled).toBe(false);

      registry.setEnabled('toggle_tool', true);
      expect(registry.get('toggle_tool')?.enabled).toBe(true);
    });

    it('should get statistics', () => {
      registry.register(createValidTool('stat_a', { category: 'cat1' }));
      registry.register(createValidTool('stat_b', { category: 'cat1' }));
      registry.register(createValidTool('stat_c', { category: 'cat2' }));
      registry.setEnabled('stat_c', false);

      const stats = registry.getStats();

      expect(stats.totalTools).toBe(3);
      expect(stats.enabledTools).toBe(2);
      expect(stats.byCategory['cat1']).toBe(2);
      expect(stats.byCategory['cat2']).toBe(1);
    });
  });
});

describe('defineTool', () => {
  it('should create a valid tool definition', () => {
    const tool = defineTool(
      'helper_tool',
      'A tool created with the helper',
      {
        type: 'object',
        properties: {
          input: { type: 'string' },
        },
      },
      async () => ({ success: true }),
      { category: 'helpers', version: '1.0.0' }
    );

    expect(tool.name).toBe('helper_tool');
    expect(tool.description).toBe('A tool created with the helper');
    expect(tool.metadata?.category).toBe('helpers');
    expect(tool.metadata?.version).toBe('1.0.0');
  });
});

// Helper function to create valid test tools
function createValidTool(
  name: string,
  metadata?: { category?: string; tags?: string[] }
): ToolDefinition {
  return {
    name,
    description: `Test tool: ${name} - a valid test tool`,
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string' },
      },
    },
    execute: async () => ({ success: true }),
    metadata,
  };
}
