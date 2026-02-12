import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { createAuditCommand } from '../audit.js';

describe('audit command', () => {
  let consoleSpy: { log: ReturnType<typeof vi.spyOn> };

  beforeEach(() => {
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    };
  });

  it('outputs table and JSON with correct shape', async () => {
    // Table output
    const program = new Command();
    program.addCommand(createAuditCommand());
    await program.parseAsync(['node', 'stackmemory', 'audit']);
    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining('TOTAL')
    );

    // JSON output
    consoleSpy.log.mockClear();
    const program2 = new Command();
    program2.addCommand(createAuditCommand());
    await program2.parseAsync(['node', 'stackmemory', 'audit', '--json']);

    const jsonCall = consoleSpy.log.mock.calls.find((call) => {
      try {
        return 'entries' in JSON.parse(call[0]);
      } catch {
        return false;
      }
    });
    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse(jsonCall![0]);
    expect(Array.isArray(parsed.entries)).toBe(true);
    expect(typeof parsed.totalTokens).toBe('number');
  });
});
