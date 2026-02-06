/**
 * Tmux Manager
 *
 * Creates and manages tmux sessions for parallel Claude workers.
 * Each pane runs an isolated claude-sm instance.
 */

import { execSync } from 'child_process';

export function isTmuxAvailable(): boolean {
  try {
    execSync('which tmux', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function createTmuxSession(name: string, paneCount: number): void {
  // Create a detached session with the first pane
  execSync(`tmux new-session -d -s ${name}`, { stdio: 'ignore' });

  // Add remaining panes
  for (let i = 1; i < paneCount; i++) {
    execSync(`tmux split-window -t ${name}`, { stdio: 'ignore' });
    // Rebalance after each split to prevent "no space" errors
    execSync(`tmux select-layout -t ${name} tiled`, { stdio: 'ignore' });
  }

  // Final tiled layout
  execSync(`tmux select-layout -t ${name} tiled`, { stdio: 'ignore' });
}

export function sendToPane(
  session: string,
  pane: string,
  command: string
): void {
  execSync(
    `tmux send-keys -t ${session}:${pane} ${shellEscape(command)} Enter`,
    {
      stdio: 'ignore',
    }
  );
}

export function killTmuxSession(name: string): void {
  execSync(`tmux kill-session -t ${name}`, { stdio: 'ignore' });
}

export function attachToSession(name: string): void {
  execSync(`tmux attach-session -t ${name}`, { stdio: 'inherit' });
}

export function listPanes(session: string): string[] {
  try {
    const output = execSync(
      `tmux list-panes -t ${session} -F "#{pane_index}"`,
      { encoding: 'utf-8' }
    );
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export function sendCtrlC(session: string, pane: string): void {
  execSync(`tmux send-keys -t ${session}:${pane} C-c`, { stdio: 'ignore' });
}

export function sessionExists(name: string): boolean {
  try {
    execSync(`tmux has-session -t ${name}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function shellEscape(cmd: string): string {
  // Wrap in single quotes, escaping existing single quotes
  return "'" + cmd.replace(/'/g, "'\\''") + "'";
}
