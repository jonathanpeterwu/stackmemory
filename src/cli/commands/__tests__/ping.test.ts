import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { createPingCommand } from '../ping.js';

describe('ping command', () => {
  let consoleSpy: { log: ReturnType<typeof vi.spyOn> };

  beforeEach(() => {
    consoleSpy = { log: vi.spyOn(console, 'log').mockImplementation(() => {}) };
  });

  it('prints pong with timestamp', async () => {
    const program = new Command();
    program.addCommand(createPingCommand());

    await program.parseAsync(['node', 'stackmemory', 'ping']);

    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^pong \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      )
    );
  });
});
