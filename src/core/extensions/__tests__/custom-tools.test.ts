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
    it.each([
      ['valid tool', 'test_tool', true],
      ['abc (min length)', 'abc', true],
      ['with underscores', 'my_tool_123', true],
      ['too short', 'ab', false],
      ['uppercase', 'A_UPPER', false],
      ['starts with number', '123start', false],
      ['has dash', 'has-dash', false],
      ['has space', 'has space', false],
    ])('tool name validation: %s', (_desc, name, shouldPass) => {
      const tool = createValidTool(name);
      if (shouldPass) {
        expect(() => registry.register(tool)).not.toThrow();
      } else {
        expect(() => registry.register(tool)).toThrow();
      }
    });

    it('should reject duplicates and invalid schemas', () => {
      const tool = createValidTool('dup_tool');
      registry.register(tool);
      expect(() => registry.register(tool)).toThrow('already registered');

      expect(() =>
        registry.register({
          name: 'short_desc',
          description: 'Short',
          parameters: { type: 'object' },
          execute: async () => ({ success: true }),
        })
      ).toThrow('at least 10 characters');

      expect(() =>
        registry.register({
          name: 'bad_schema',
          description: 'A tool with invalid schema',
          parameters: { type: 'string' } as unknown as JSONSchema,
          execute: async () => ({ success: true }),
        })
      ).toThrow();
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

    it('should get, list, and filter tools', () => {
      expect(registry.get('tool_one')?.name).toBe('tool_one');
      expect(registry.get('unknown')).toBeUndefined();
      expect(registry.list()).toHaveLength(3);
      expect(registry.list({ category: 'utils' })).toHaveLength(2);
      expect(registry.list({ tags: ['async'] })).toHaveLength(2);

      const mcpTools = registry.getMCPToolDefinitions();
      expect(mcpTools).toHaveLength(3);
      expect(mcpTools[0]).toHaveProperty('inputSchema');

      registry.setEnabled('tool_one', false);
      expect(registry.list({ enabled: true })).toHaveLength(2);
      expect(registry.list({ enabled: false })).toHaveLength(1);
    });
  });

  describe('execution', () => {
    it('should execute tools and handle basic scenarios', async () => {
      const echoTool = defineTool(
        'echo_tool',
        'A tool that echoes input',
        {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
        },
        async (p) => ({
          success: true,
          data: (p as { message: string }).message,
        })
      );
      registry.register(echoTool);

      const result = await registry.execute('echo_tool', { message: 'hello' });
      expect(result.success).toBe(true);
      expect(result.data).toBe('hello');

      // Unknown tool
      expect((await registry.execute('unknown_tool', {})).error).toContain(
        'not found'
      );

      // Disabled tool
      registry.register(createValidTool('disabled_tool'));
      registry.setEnabled('disabled_tool', false);
      expect((await registry.execute('disabled_tool', {})).error).toContain(
        'disabled'
      );
    });

    it('should validate parameters', async () => {
      registry.register(
        defineTool(
          'req_params',
          'Tool with required params',
          {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
          async () => ({ success: true })
        )
      );
      expect((await registry.execute('req_params', {})).error).toContain(
        'Missing required'
      );

      registry.register(
        defineTool(
          'typed_params',
          'Tool with typed params',
          { type: 'object', properties: { count: { type: 'number' } } },
          async () => ({ success: true })
        )
      );
      expect(
        (await registry.execute('typed_params', { count: 'x' })).error
      ).toContain('must be of type number');

      registry.register(
        defineTool(
          'range_params',
          'Tool with range',
          {
            type: 'object',
            properties: { v: { type: 'number', minimum: 0, maximum: 100 } },
          },
          async () => ({ success: true })
        )
      );
      expect(
        (await registry.execute('range_params', { v: -1 })).error
      ).toContain('at least 0');
      expect(
        (await registry.execute('range_params', { v: 101 })).error
      ).toContain('at most 100');

      registry.register(
        defineTool(
          'enum_params',
          'Tool with enum',
          {
            type: 'object',
            properties: { s: { type: 'string', enum: ['a', 'b'] } },
          },
          async () => ({ success: true })
        )
      );
      expect(
        (await registry.execute('enum_params', { s: 'x' })).error
      ).toContain('must be one of');
    });

    it('should handle errors, timeouts, and track usage', async () => {
      registry.register(
        defineTool(
          'err_tool',
          'Tool that throws errors',
          { type: 'object' },
          async () => {
            throw new Error('Oops');
          }
        )
      );
      expect((await registry.execute('err_tool', {})).error).toContain('Oops');

      registry.register(
        defineTool(
          'slow_tool',
          'A slow tool that times out',
          { type: 'object' },
          async () => {
            await new Promise((r) => setTimeout(r, 5000));
            return { success: true };
          },
          { timeout: 100 }
        )
      );
      expect(
        (await registry.execute('slow_tool', {}, { timeout: 100 })).error
      ).toContain('timed out');

      registry.register(createValidTool('stats_tool'));
      await registry.execute('stats_tool', {});
      await registry.execute('stats_tool', {});
      expect(registry.get('stats_tool')?.usageCount).toBe(2);
    });
  });

  describe('extension context', () => {
    it('should provide storage, events, and logging', async () => {
      // Storage
      const storageTool = defineTool(
        'storage_tool',
        'Uses storage',
        { type: 'object' },
        async (_, ctx) => {
          await ctx.storage.set('k', 'v');
          return { success: true, data: await ctx.storage.get('k') };
        }
      );
      registry.register(storageTool);
      expect((await registry.execute('storage_tool', {})).data).toBe('v');

      // Events
      const events: unknown[] = [];
      const eventTool = defineTool(
        'event_tool',
        'Emits events',
        { type: 'object' },
        async (_, ctx) => {
          ctx.on('evt', (d) => events.push(d));
          ctx.emit('evt', { m: 'hi' });
          return { success: true };
        }
      );
      registry.register(eventTool);
      await registry.execute('event_tool', {});
      expect(events[0]).toEqual({ m: 'hi' });

      // Logging (just ensure no crash)
      const logTool = defineTool(
        'log_tool',
        'Logs messages',
        { type: 'object' },
        async (_, ctx) => {
          ctx.log.info('i');
          ctx.log.warn('w');
          ctx.log.error('e');
          return { success: true };
        }
      );
      registry.register(logTool);
      expect((await registry.execute('log_tool', {})).success).toBe(true);
    });
  });

  describe('management', () => {
    it('should manage tools: unregister, update, enable/disable, stats', () => {
      registry.register(createValidTool('to_remove'));
      expect(registry.unregister('to_remove')).toBe(true);
      expect(registry.has('to_remove')).toBe(false);
      expect(registry.unregister('unknown')).toBe(false);

      registry.register(createValidTool('update_me'));
      registry.update('update_me', {
        description: 'Updated description for tool',
      });
      expect(registry.get('update_me')?.description).toBe(
        'Updated description for tool'
      );

      registry.register(createValidTool('toggle_tool'));
      registry.setEnabled('toggle_tool', false);
      expect(registry.get('toggle_tool')?.enabled).toBe(false);
      registry.setEnabled('toggle_tool', true);
      expect(registry.get('toggle_tool')?.enabled).toBe(true);

      registry.register(createValidTool('stat_a', { category: 'cat1' }));
      registry.register(createValidTool('stat_b', { category: 'cat1' }));
      registry.register(createValidTool('stat_c', { category: 'cat2' }));
      registry.setEnabled('stat_c', false);
      const stats = registry.getStats();
      expect(stats.totalTools).toBe(5);
      expect(stats.byCategory['cat1']).toBe(2);
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
