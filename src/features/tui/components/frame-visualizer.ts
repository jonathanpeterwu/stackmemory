/**
 * Frame Visualizer Component
 * Displays frame storage hierarchy with tier indicators
 */

import contrib from 'blessed-contrib';
import { EventEmitter } from 'events';
import type { FrameData, FrameNode } from '../types.js';

export class FrameVisualizer extends EventEmitter {
  private tree: any; // contrib.tree type
  private frames: Map<string, FrameData>;
  private rootNodes: FrameNode[];
  private selectedFrame: string | null = null;

  constructor(tree: any) {
    super();
    this.tree = tree;
    this.frames = new Map();
    this.rootNodes = [];
    this.initializeUI();
  }

  private initializeUI(): void {
    // Configure tree widget
    this.tree.rows.interactive = true;
    this.tree.rows.mouse = true;
    
    // Set initial data
    this.tree.setData({
      extended: true,
      children: {
        'Sessions': {
          extended: true,
          children: {
            'Loading...': {}
          }
        }
      }
    });

    // Handle selection
    this.tree.rows.on('select', (node: any) => {
      if (node && node.frameId) {
        this.selectFrame(node.frameId);
      }
    });

    // Add legend
    this.addLegend();
  }

  private addLegend(): void {
    const legend = `{gray-fg}Tiers: {red-fg}● Hot{/} {yellow-fg}● Warm{/} {blue-fg}● Cold{/}{/}`;
    // The tree widget itself doesn't have setLabel, only box widgets do
    // We'll update the label when we update the tree data
  }

  /**
   * Build tree structure from flat frame data
   */
  private buildFrameTree(frames: FrameData[]): FrameNode[] {
    const nodeMap = new Map<string, FrameNode>();
    const rootNodes: FrameNode[] = [];

    // Create nodes
    frames.forEach(frame => {
      const node: FrameNode = {
        id: frame.id,
        label: this.formatFrameLabel(frame),
        children: [],
        extended: frame.type === 'root',
        tier: frame.tier,
        score: frame.score || 0
      };
      nodeMap.set(frame.id, node);
    });

    // Build hierarchy
    frames.forEach(frame => {
      const node = nodeMap.get(frame.id);
      if (!node) return;

      if (frame.parentId) {
        const parent = nodeMap.get(frame.parentId);
        if (parent) {
          parent.children = parent.children || [];
          parent.children.push(node);
        } else {
          rootNodes.push(node);
        }
      } else {
        rootNodes.push(node);
      }
    });

    // Sort by score and timestamp
    const sortNodes = (nodes: FrameNode[]) => {
      nodes.sort((a, b) => b.score - a.score);
      nodes.forEach(node => {
        if (node.children && node.children.length > 0) {
          sortNodes(node.children);
        }
      });
    };

    sortNodes(rootNodes);
    return rootNodes;
  }

  private formatFrameLabel(frame: FrameData): string {
    const tierIcon = this.getTierIcon(frame.tier);
    const typeIcon = this.getTypeIcon(frame.type);
    const timestamp = new Date(frame.timestamp).toLocaleTimeString();
    const tokens = frame.tokenCount ? `[${this.formatTokens(frame.tokenCount)}]` : '';
    const compression = frame.compressionRatio ? `(${frame.compressionRatio.toFixed(1)}x)` : '';
    
    let label = `${tierIcon} ${typeIcon} ${timestamp} ${tokens} ${compression}`;
    
    if (frame.digest) {
      const digest = frame.digest.length > 30 
        ? frame.digest.substring(0, 30) + '...' 
        : frame.digest;
      label += ` - ${digest}`;
    }
    
    return label;
  }

  private getTierIcon(tier: string): string {
    switch (tier) {
      case 'hot': return '{red-fg}●{/}';
      case 'warm': return '{yellow-fg}●{/}';
      case 'cold': return '{blue-fg}●{/}';
      default: return '{gray-fg}○{/}';
    }
  }

  private getTypeIcon(type: string): string {
    switch (type) {
      case 'root': return '📁';
      case 'branch': return '🌿';
      case 'leaf': return '🍃';
      default: return '📄';
    }
  }

  private formatTokens(tokens: number): string {
    if (tokens < 1000) return `${tokens}`;
    if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
    return `${(tokens / 1000000).toFixed(1)}M`;
  }

  /**
   * Convert FrameNode tree to blessed-contrib tree format
   */
  private convertToTreeData(nodes: FrameNode[]): any {
    const treeData: any = {};
    
    // Group by session
    const sessionGroups = new Map<string, FrameNode[]>();
    
    nodes.forEach(node => {
      const sessionId = this.frames.get(node.id)?.sessionId || 'unknown';
      if (!sessionGroups.has(sessionId)) {
        sessionGroups.set(sessionId, []);
      }
      sessionGroups.get(sessionId)!.push(node);
    });

    // Build tree structure
    sessionGroups.forEach((sessionNodes, sessionId) => {
      const sessionLabel = `Session: ${sessionId.substring(0, 8)}`;
      treeData[sessionLabel] = {
        extended: true,
        children: this.buildNodeChildren(sessionNodes)
      };
    });

    // Add statistics
    const stats = this.calculateStatistics();
    treeData['Statistics'] = {
      extended: false,
      children: {
        [`Total Frames: ${stats.total}`]: {},
        [`Hot Tier: ${stats.hot} (${stats.hotSize})`]: {},
        [`Warm Tier: ${stats.warm} (${stats.warmSize})`]: {},
        [`Cold Tier: ${stats.cold} (${stats.coldSize})`]: {},
        [`Avg Compression: ${stats.avgCompression.toFixed(1)}x`]: {},
        [`Total Tokens: ${this.formatTokens(stats.totalTokens)}`]: {}
      }
    };

    return treeData;
  }

  private buildNodeChildren(nodes: FrameNode[]): any {
    const children: any = {};
    
    nodes.forEach(node => {
      const nodeData: any = {
        frameId: node.id,
        extended: node.extended
      };
      
      if (node.children && node.children.length > 0) {
        nodeData.children = this.buildNodeChildren(node.children);
      }
      
      children[node.label] = nodeData;
    });
    
    return children;
  }

  private calculateStatistics(): any {
    const frames = Array.from(this.frames.values());
    const stats = {
      total: frames.length,
      hot: 0,
      warm: 0,
      cold: 0,
      hotSize: '0B',
      warmSize: '0B',
      coldSize: '0B',
      totalTokens: 0,
      avgCompression: 0
    };

    let hotBytes = 0;
    let warmBytes = 0;
    let coldBytes = 0;
    let totalCompression = 0;
    let compressionCount = 0;

    frames.forEach(frame => {
      // Count by tier
      switch (frame.tier) {
        case 'hot':
          stats.hot++;
          hotBytes += frame.tokenCount * 4; // Rough estimate: 4 bytes per token
          break;
        case 'warm':
          stats.warm++;
          warmBytes += frame.tokenCount * 4;
          break;
        case 'cold':
          stats.cold++;
          coldBytes += frame.tokenCount * 4;
          break;
      }

      stats.totalTokens += frame.tokenCount || 0;
      
      if (frame.compressionRatio) {
        totalCompression += frame.compressionRatio;
        compressionCount++;
      }
    });

    stats.hotSize = this.formatBytes(hotBytes);
    stats.warmSize = this.formatBytes(warmBytes);
    stats.coldSize = this.formatBytes(coldBytes);
    stats.avgCompression = compressionCount > 0 ? totalCompression / compressionCount : 1.0;

    return stats;
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)}MB`;
    return `${(bytes / 1073741824).toFixed(1)}GB`;
  }

  public update(frames: FrameData[]): void {
    // Update frame map
    this.frames.clear();
    frames.forEach(frame => {
      this.frames.set(frame.id, frame);
    });

    // Build tree structure
    this.rootNodes = this.buildFrameTree(frames);
    
    // Convert to tree widget format
    const treeData = this.convertToTreeData(this.rootNodes);
    
    // Update tree widget
    this.tree.setData(treeData);
    
    // Update label with stats if the tree has a parent box container
    const stats = this.calculateStatistics();
    // Stats will be shown in the tree data instead

    this.tree.screen.render();
  }

  private selectFrame(frameId: string): void {
    this.selectedFrame = frameId;
    const frame = this.frames.get(frameId);
    if (frame) {
      this.emit('frame:selected', frame);
      this.showFrameDetails(frame);
    }
  }

  private showFrameDetails(frame: FrameData): void {
    const details = blessed.box({
      parent: this.tree.screen,
      top: 'center',
      left: 'center',
      width: '60%',
      height: '60%',
      content: this.formatFrameDetails(frame),
      tags: true,
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'yellow'
        }
      },
      scrollable: true,
      keys: true,
      vi: true,
      mouse: true,
      hidden: false,
      label: ` Frame: ${frame.id.substring(0, 8)} `
    });

    details.key(['escape', 'q'], () => {
      details.destroy();
      this.tree.screen.render();
    });

    // Add migrate button
    details.key(['m'], () => {
      this.migrateFrame(frame);
      details.destroy();
      this.tree.screen.render();
    });

    details.focus();
    this.tree.screen.render();
  }

  private formatFrameDetails(frame: FrameData): string {
    let details = `{bold}Frame ID:{/} ${frame.id}\n`;
    details += `{bold}Session:{/} ${frame.sessionId}\n`;
    details += `{bold}Type:{/} ${frame.type}\n`;
    details += `{bold}Tier:{/} ${this.getTierIcon(frame.tier)} ${frame.tier}\n`;
    details += `{bold}Created:{/} ${new Date(frame.timestamp).toLocaleString()}\n`;
    
    if (frame.parentId) {
      details += `{bold}Parent:{/} ${frame.parentId.substring(0, 8)}\n`;
    }
    
    details += `\n{bold}Metrics:{/}\n`;
    details += `  Tokens: ${this.formatTokens(frame.tokenCount)}\n`;
    details += `  Score: ${frame.score || 0}\n`;
    
    if (frame.compressionRatio) {
      const saved = Math.round((1 - 1/frame.compressionRatio) * 100);
      details += `  Compression: ${frame.compressionRatio.toFixed(2)}x (${saved}% saved)\n`;
    }
    
    if (frame.digest) {
      details += `\n{bold}Digest:{/}\n${frame.digest}\n`;
    }
    
    if (frame.tools && frame.tools.length > 0) {
      details += `\n{bold}Tools Used:{/}\n`;
      frame.tools.forEach(tool => {
        details += `  • ${tool}\n`;
      });
    }
    
    if (frame.inputs && frame.inputs.length > 0) {
      details += `\n{bold}Inputs ({${frame.inputs.length}}):{/}\n`;
      frame.inputs.slice(0, 3).forEach(input => {
        const preview = input.length > 50 ? input.substring(0, 50) + '...' : input;
        details += `  ${preview}\n`;
      });
    }
    
    if (frame.outputs && frame.outputs.length > 0) {
      details += `\n{bold}Outputs ({${frame.outputs.length}}):{/}\n`;
      frame.outputs.slice(0, 3).forEach(output => {
        const preview = output.length > 50 ? output.substring(0, 50) + '...' : output;
        details += `  ${preview}\n`;
      });
    }
    
    if (frame.children && frame.children.length > 0) {
      details += `\n{bold}Children:{/} ${frame.children.length} frames\n`;
    }
    
    if (frame.references && frame.references.length > 0) {
      details += `{bold}References:{/} ${frame.references.length} frames\n`;
    }
    
    details += `\n{gray-fg}[m] Migrate Tier | [d] Delete | [e] Export{/}\n`;
    
    return details;
  }

  private migrateFrame(frame: FrameData): void {
    // Determine next tier
    const tierOrder = ['hot', 'warm', 'cold'];
    const currentIndex = tierOrder.indexOf(frame.tier);
    const nextTier = tierOrder[(currentIndex + 1) % tierOrder.length];
    
    // Emit migration event
    this.emit('frame:migrate', {
      frameId: frame.id,
      fromTier: frame.tier,
      toTier: nextTier
    });
    
    // Optimistically update UI
    frame.tier = nextTier as 'hot' | 'warm' | 'cold';
    this.update(Array.from(this.frames.values()));
  }

  public focus(): void {
    this.tree.rows.focus();
  }

  public hasFocus(): boolean {
    return this.tree.rows === this.tree.screen.focused;
  }
}