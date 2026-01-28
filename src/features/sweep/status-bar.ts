/**
 * Sweep Status Bar
 *
 * Renders a 1-row prediction status bar at the bottom of the terminal
 * using ANSI escape sequences. Preserves cursor position.
 */

import { basename } from 'path';

// ANSI escape sequences
const ESC = '\x1b';
const SAVE_CURSOR = `${ESC}7`;
const RESTORE_CURSOR = `${ESC}8`;
const CLEAR_LINE = `${ESC}[2K`;
const RESET = `${ESC}[0m`;
const BG_DARK = `${ESC}[48;5;236m`; // dark gray bg
const FG_GRAY = `${ESC}[38;5;244m`; // gray text
const FG_CYAN = `${ESC}[38;5;37m`; // cyan for label
const FG_DIM = `${ESC}[2m`; // dim
const BOLD = `${ESC}[1m`;

function moveTo(row: number, col: number): string {
  return `${ESC}[${row};${col}H`;
}

export class StatusBar {
  private rows: number;
  private cols: number;
  private visible = false;
  private currentPrediction = '';
  private currentFile = '';

  constructor() {
    this.rows = process.stdout.rows || 24;
    this.cols = process.stdout.columns || 80;
  }

  show(prediction: string, filePath: string, latencyMs: number): void {
    this.currentPrediction = prediction;
    this.currentFile = filePath;
    this.visible = true;

    const file = basename(filePath);
    const preview = this.truncatePreview(prediction);
    const latency = `${latencyMs}ms`;

    // Build status bar content
    const label = `${FG_CYAN}${BOLD}[Sweep]${RESET}${BG_DARK}`;
    const fileInfo = `${FG_GRAY} ${file}${RESET}${BG_DARK}`;
    const content = `${FG_GRAY} ${preview}${RESET}${BG_DARK}`;
    const time = `${FG_DIM}${BG_DARK} ${latency}${RESET}${BG_DARK}`;
    const keys = `${BOLD}${BG_DARK}  [Tab]${RESET}${BG_DARK}${FG_GRAY} Accept  ${BOLD}${BG_DARK}[Esc]${RESET}${BG_DARK}${FG_GRAY} Dismiss${RESET}`;

    const bar = `${BG_DARK}${label}${fileInfo}${content}${time}${keys}${RESET}`;

    this.render(bar);
  }

  showLoading(): void {
    this.visible = true;
    const bar = `${BG_DARK}${FG_CYAN}${BOLD}[Sweep]${RESET}${BG_DARK}${FG_GRAY} Predicting next edit...${RESET}`;
    this.render(bar);
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.currentPrediction = '';
    this.currentFile = '';

    const output =
      SAVE_CURSOR + moveTo(this.rows, 1) + CLEAR_LINE + RESTORE_CURSOR;

    process.stdout.write(output);
  }

  resize(rows: number, cols: number): void {
    this.rows = rows;
    this.cols = cols;
    if (this.visible && this.currentPrediction) {
      this.show(this.currentPrediction, this.currentFile, 0);
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  private render(content: string): void {
    if (!process.stdout.isTTY) return;

    const output =
      SAVE_CURSOR +
      moveTo(this.rows, 1) +
      CLEAR_LINE +
      content +
      RESTORE_CURSOR;

    process.stdout.write(output);
  }

  private truncatePreview(prediction: string): string {
    // Take first non-empty line
    const lines = prediction.trim().split('\n');
    let preview = lines[0] || '';

    // Max preview length: cols minus label/keys overhead (~50 chars)
    const maxLen = Math.max(10, this.cols - 55);
    if (preview.length > maxLen) {
      preview = preview.slice(0, maxLen - 3) + '...';
    }

    // Indicate more lines
    if (lines.length > 1) {
      preview += ` (+${lines.length - 1} lines)`;
    }

    return preview;
  }
}
