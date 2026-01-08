/**
 * Analytics Panel Component
 * Real-time charts and metrics visualization
 */

import contrib from 'blessed-contrib';
import { EventEmitter } from 'events';
import type { AnalyticsData } from '../types.js';

export class AnalyticsPanel extends EventEmitter {
  private line: any; // contrib.line type
  private currentMetric: 'tokens' | 'velocity' | 'quality' | 'performance' = 'tokens';
  private data: AnalyticsData | null = null;

  constructor(line: any) {
    super();
    this.line = line;
    this.initializeUI();
  }

  private initializeUI(): void {
    // Cycle through metrics
    this.line.screen.key(['m'], () => {
      this.cycleMetric();
    });

    // Set initial display
    this.showTokenUsage();
  }

  private cycleMetric(): void {
    const metrics: Array<typeof this.currentMetric> = ['tokens', 'velocity', 'quality', 'performance'];
    const currentIndex = metrics.indexOf(this.currentMetric);
    this.currentMetric = metrics[(currentIndex + 1) % metrics.length];
    
    switch (this.currentMetric) {
      case 'tokens':
        this.showTokenUsage();
        break;
      case 'velocity':
        this.showVelocity();
        break;
      case 'quality':
        this.showQuality();
        break;
      case 'performance':
        this.showPerformance();
        break;
    }
  }

  private showTokenUsage(): void {
    if (!this.data) return;
    
    const data = [{
      title: 'Token Usage',
      x: this.data.tokens.labels.map((_, i) => i.toString()),
      y: this.data.tokens.values,
      style: { line: 'yellow' }
    }];
    
    this.line.setData(data);
    if (typeof this.line.setLabel === 'function') {
      this.line.setLabel(' 📈 Analytics - Token Usage [m] cycle ');
    }
    this.line.screen.render();
  }

  private showVelocity(): void {
    if (!this.data) return;
    
    const data = [{
      title: 'Task Velocity',
      x: this.data.tasks.velocity.map((_, i) => `Sprint ${i + 1}`),
      y: this.data.tasks.velocity,
      style: { line: 'green' }
    }];
    
    this.line.setData(data);
    if (typeof this.line.setLabel === 'function') {
      this.line.setLabel(' 📈 Analytics - Task Velocity [m] cycle ');
    }
    this.line.screen.render();
  }

  private showQuality(): void {
    if (!this.data) return;
    
    const data = [
      {
        title: 'Tests Passed',
        x: ['1', '2', '3', '4', '5'],
        y: [this.data.quality.testsPassed, this.data.quality.testsPassed, this.data.quality.testsPassed, this.data.quality.testsPassed, this.data.quality.testsPassed],
        style: { line: 'green' }
      },
      {
        title: 'Coverage %',
        x: ['1', '2', '3', '4', '5'],
        y: [this.data.quality.coverage, this.data.quality.coverage, this.data.quality.coverage, this.data.quality.coverage, this.data.quality.coverage],
        style: { line: 'blue' }
      }
    ];
    
    this.line.setData(data);
    if (typeof this.line.setLabel === 'function') {
      this.line.setLabel(' 📈 Analytics - Code Quality [m] cycle ');
    }
    this.line.screen.render();
  }

  private showPerformance(): void {
    if (!this.data) return;
    
    const data = [
      {
        title: 'Response Time (ms)',
        x: this.data.performance.avgResponseTime.map((_, i) => i.toString()),
        y: this.data.performance.avgResponseTime,
        style: { line: 'cyan' }
      },
      {
        title: 'Error Rate (%)',
        x: this.data.performance.errorRate.map((_, i) => i.toString()),
        y: this.data.performance.errorRate.map((r: any) => r * 100),
        style: { line: 'red' }
      }
    ];
    
    this.line.setData(data);
    if (typeof this.line.setLabel === 'function') {
      this.line.setLabel(' 📈 Analytics - Performance [m] cycle ');
    }
    this.line.screen.render();
  }

  public update(data: AnalyticsData): void {
    this.data = data;
    
    // Refresh current view
    switch (this.currentMetric) {
      case 'tokens':
        this.showTokenUsage();
        break;
      case 'velocity':
        this.showVelocity();
        break;
      case 'quality':
        this.showQuality();
        break;
      case 'performance':
        this.showPerformance();
        break;
    }
  }

  public focus(): void {
    // Line chart doesn't have traditional focus
    this.emit('focused');
  }

  public hasFocus(): boolean {
    return false; // Line charts don't take focus
  }
}