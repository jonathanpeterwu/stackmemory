/**
 * Terminal Compatibility Layer
 * Handles different terminal environments (Ghostty, tmux, standard terminals)
 */

import os from 'os';
import { execSync } from 'child_process';
// Type-safe environment variable access
function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Environment variable ${key} is required`);
  }
  return value;
}

function getOptionalEnv(key: string): string | undefined {
  return process.env[key];
}


export interface TerminalInfo {
  type: 'ghostty' | 'tmux' | 'iterm2' | 'terminal' | 'xterm' | 'unknown';
  isInsideTmux: boolean;
  supportsTrueColor: boolean;
  supportsUnicode: boolean;
  termEnv: string;
  recommendedConfig: BlessedConfig;
}

export interface BlessedConfig {
  smartCSR: boolean;
  fullUnicode: boolean;
  forceUnicode: boolean | null;
  dockBorders: boolean;
  terminal: string;
  title: string;
  // Compatibility flags
  artificalCursor?: boolean;
  grabKeys?: boolean;
  sendFocus?: boolean;
  warnings?: boolean;
}

export class TerminalCompatibility {
  private static instance: TerminalCompatibility;
  private terminalInfo: TerminalInfo;

  private constructor() {
    this.terminalInfo = this.detectTerminal();
  }

  static getInstance(): TerminalCompatibility {
    if (!this.instance) {
      this.instance = new TerminalCompatibility();
    }
    return this.instance;
  }

  private detectTerminal(): TerminalInfo {
    const termEnv = process.env['TERM'] || '';
    const termProgram = process.env['TERM_PROGRAM'] || '';
    const isInsideTmux = !!process.env['TMUX'];
    const isGhostty = termEnv.includes('ghostty') || termProgram === 'ghostty';
    const isIterm2 = termProgram === 'iTerm.app';
    const isTerminalApp = termProgram === 'Apple_Terminal';
    
    let type: TerminalInfo['type'] = 'unknown';
    
    if (isGhostty) {
      type = 'ghostty';
    } else if (isInsideTmux) {
      type = 'tmux';
    } else if (isIterm2) {
      type = 'iterm2';
    } else if (isTerminalApp) {
      type = 'terminal';
    } else if (termEnv.includes('xterm')) {
      type = 'xterm';
    }

    // Check for true color support
    const supportsTrueColor = this.checkTrueColorSupport();
    const supportsUnicode = this.checkUnicodeSupport();

    // Get recommended config based on terminal type
    const recommendedConfig = this.getRecommendedConfig(type, isInsideTmux);

    return {
      type,
      isInsideTmux,
      supportsTrueColor,
      supportsUnicode,
      termEnv,
      recommendedConfig
    };
  }

  private checkTrueColorSupport(): boolean {
    const colorterm = process.env['COLORTERM'];
    if (colorterm === 'truecolor' || colorterm === '24bit') {
      return true;
    }
    
    // Check terminal specific env vars
    const termProgram = process.env['TERM_PROGRAM'] || '';
    if (['iTerm.app', 'Hyper', 'vscode'].includes(termProgram)) {
      return true;
    }
    
    return false;
  }

  private checkUnicodeSupport(): boolean {
    // Most modern terminals support unicode
    const lang = process.env['LANG'] || '';
    const lcAll = process.env['LC_ALL'] || '';
    const lcCtype = process.env['LC_CTYPE'] || '';
    
    const hasUtf8 = [lang, lcAll, lcCtype].some(v => 
      v.toLowerCase().includes('utf-8') || v.toLowerCase().includes('utf8')
    );
    
    return hasUtf8;
  }

  private getRecommendedConfig(
    type: TerminalInfo['type'],
    isInsideTmux: boolean
  ): BlessedConfig {
    const baseConfig: BlessedConfig = {
      smartCSR: true,
      fullUnicode: true,
      forceUnicode: null,
      dockBorders: true,
      terminal: 'xterm-256color',
      title: 'StackMemory TUI Dashboard',
      warnings: false
    };

    // Terminal-specific adjustments
    switch (type) {
      case 'ghostty':
        // Ghostty has issues with certain escape sequences
        return {
          ...baseConfig,
          smartCSR: false, // Disable smart cursor restore
          terminal: 'xterm', // Use basic xterm instead of xterm-256color
          dockBorders: false, // Can cause rendering issues
          artificalCursor: true, // Use artificial cursor
          grabKeys: false, // Don't grab all keys
          sendFocus: false // Don't send focus events
        };
      
      case 'tmux':
        // Inside tmux, we need to be more conservative
        return {
          ...baseConfig,
          terminal: isInsideTmux ? 'screen-256color' : 'xterm-256color',
          smartCSR: !isInsideTmux, // Disable inside tmux
          sendFocus: false
        };
      
      case 'iterm2':
        // iTerm2 has excellent terminal support
        return {
          ...baseConfig,
          terminal: 'xterm-256color',
          fullUnicode: true,
          forceUnicode: true
        };
      
      case 'terminal':
        // macOS Terminal.app
        return {
          ...baseConfig,
          terminal: 'xterm-256color',
          fullUnicode: true
        };
      
      case 'xterm':
      default:
        // Conservative defaults for unknown terminals
        return {
          ...baseConfig,
          smartCSR: false,
          fullUnicode: false,
          forceUnicode: false
        };
    }
  }

  getTerminalInfo(): TerminalInfo {
    return this.terminalInfo;
  }

  getBlessedConfig(): BlessedConfig {
    return this.terminalInfo.recommendedConfig;
  }

  /**
   * Set optimal TERM environment variable for the detected terminal
   */
  configureEnvironment(): void {
    const { type, isInsideTmux } = this.terminalInfo;
    
    if (type === 'ghostty') {
      // Ghostty works better with basic xterm
      process.env['TERM'] = 'xterm';
    } else if (isInsideTmux) {
      // Inside tmux, use screen-256color
      process.env['TERM'] = 'screen-256color';
    } else if (!process.env['TERM'] || process.env['TERM'] === 'dumb') {
      // Fallback to xterm-256color if not set
      process.env['TERM'] = 'xterm-256color';
    }

    // Disable Node warnings that can interfere with TUI
    process.env['NODE_NO_WARNINGS'] = '1';
  }

  /**
   * Check if terminal is suitable for TUI
   */
  isCompatible(): boolean {
    // Check if we're in a non-interactive environment
    if (process.env['CI'] || process.env['CONTINUOUS_INTEGRATION']) {
      return false;
    }

    // Check if terminal is too basic
    const term = process.env['TERM'] || '';
    if (term === 'dumb') {
      return false;
    }

    // Allow if FORCE_TUI is set
    if (process.env['FORCE_TUI']) {
      return true;
    }

    // Check if any TTY is available (stdout, stdin, or stderr)
    const hasAnyTTY = process.stdout.isTTY || process.stdin.isTTY || process.stderr.isTTY;
    
    // When running through npm/node, TTY detection might fail
    // but we still want to allow TUI if terminal is capable
    if (!hasAnyTTY) {
      const { type } = this.terminalInfo;
      // Allow known terminal types even without TTY detection
      if (type !== 'unknown' || term.includes('xterm') || term.includes('screen')) {
        return true;
      }
      return false;
    }

    return true;
  }

  /**
   * Get compatibility warnings for the current terminal
   */
  getWarnings(): string[] {
    const warnings: string[] = [];
    const { type, supportsUnicode, supportsTrueColor } = this.terminalInfo;

    if (type === 'ghostty') {
      warnings.push('Ghostty terminal detected: Using compatibility mode with reduced features');
    }

    if (!supportsUnicode) {
      warnings.push('Unicode support not detected: Some icons may not display correctly');
    }

    if (!supportsTrueColor) {
      warnings.push('True color support not detected: Using 256 color mode');
    }

    if (type === 'unknown') {
      warnings.push('Unknown terminal type: Using conservative settings');
    }

    return warnings;
  }

  /**
   * Get terminal capabilities as a string for debugging
   */
  getCapabilitiesString(): string {
    const { type, isInsideTmux, supportsTrueColor, supportsUnicode, termEnv } = this.terminalInfo;
    
    return [
      `Terminal Type: ${type}`,
      `TERM: ${termEnv}`,
      `Inside tmux: ${isInsideTmux}`,
      `True Color: ${supportsTrueColor}`,
      `Unicode: ${supportsUnicode}`
    ].join(' | ');
  }
}

// Export singleton instance
export const terminalCompat = TerminalCompatibility.getInstance();