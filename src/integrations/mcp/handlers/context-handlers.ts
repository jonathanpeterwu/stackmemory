/**
 * Context-related MCP tool handlers
 * Handles frame management and context retrieval
 */

import { FrameManager, FrameType } from '../../../core/context/index.js';
import { logger } from '../../../core/monitoring/logger.js';

export interface ContextHandlerDependencies {
  frameManager: FrameManager;
}

export class ContextHandlers {
  constructor(private deps: ContextHandlerDependencies) {}

  /**
   * Get current project context
   */
  async handleGetContext(args: any): Promise<any> {
    try {
      const query = args.query || '';
      const limit = args.limit || 5;

      logger.info('Getting context', { query, limit });

      // Get hot stack context
      const hotStack = this.deps.frameManager.getHotStackContext(20);

      if (hotStack.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No active context frames found. Use start_frame to begin working on a task.',
            },
          ],
        };
      }

      // Format hot stack context
      const contextText = hotStack
        .map((frame, i) => {
          const depth = '  '.repeat(i);
          const constraints = frame.header.constraints?.length
            ? `\n${depth}  Constraints: ${frame.header.constraints.join(', ')}`
            : '';
          const events = frame.recentEvents.length
            ? `\n${depth}  Recent: ${frame.recentEvents.length} events`
            : '';

          return `${depth}Frame ${i + 1}: ${frame.header.goal}${constraints}${events}`;
        })
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Current Context Stack:\n${contextText}`,
          },
        ],
      };
    } catch (error: unknown) {
      logger.error(
        'Error getting context',
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Record a decision or important information
   */
  async handleAddDecision(args: any): Promise<any> {
    try {
      const { content, type } = args;

      if (!content) {
        throw new Error('Content is required');
      }

      const currentFrame = this.deps.frameManager.getCurrentFrameId();
      if (!currentFrame) {
        throw new Error('No active frame. Use start_frame first.');
      }

      // Add as anchor
      this.deps.frameManager.addAnchor(
        type === 'constraint' ? 'CONSTRAINT' : 'DECISION',
        content,
        type === 'constraint' ? 9 : 7
      );

      // Also add as event
      this.deps.frameManager.addEvent('decision', {
        type,
        content,
        timestamp: Date.now(),
      });

      logger.info('Added decision/constraint', { type, content });

      return {
        content: [
          {
            type: 'text',
            text: `Recorded ${type}: ${content}`,
          },
        ],
      };
    } catch (error: unknown) {
      logger.error(
        'Error adding decision',
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Start a new frame (task/subtask) on the call stack
   */
  async handleStartFrame(args: any): Promise<any> {
    try {
      const { name, type = 'task', constraints = [], definitions = {} } = args;

      if (!name) {
        throw new Error('Frame name is required');
      }

      const frameId = this.deps.frameManager.createFrame({
        type: type as FrameType,
        name,
        inputs: { constraints, definitions },
      });

      logger.info('Started frame', { frameId, name, type });

      return {
        content: [
          {
            type: 'text',
            text: `Started frame: ${name} (${frameId})`,
          },
        ],
        metadata: {
          frameId,
          type,
          name,
        },
      };
    } catch (error: unknown) {
      logger.error(
        'Error starting frame',
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Close current frame with summary
   */
  async handleCloseFrame(args: any): Promise<any> {
    try {
      const { summary, frameId } = args;
      const targetFrameId =
        frameId || this.deps.frameManager.getCurrentFrameId();

      if (!targetFrameId) {
        throw new Error('No active frame to close');
      }

      const frame = this.deps.frameManager.getFrame(targetFrameId);
      if (!frame) {
        throw new Error(`Frame not found: ${targetFrameId}`);
      }

      // Add summary if provided
      if (summary) {
        this.deps.frameManager.addEvent('observation', {
          type: 'completion_summary',
          content: summary,
          timestamp: Date.now(),
        });
      }

      this.deps.frameManager.closeFrame(
        targetFrameId,
        summary ? { summary } : {}
      );

      logger.info('Closed frame', {
        frameId: targetFrameId,
        frameName: frame.name,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Closed frame: ${frame.name}${summary ? ` with summary: ${summary}` : ''}`,
          },
        ],
      };
    } catch (error: unknown) {
      logger.error(
        'Error closing frame',
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Add an anchor (important fact) to current frame
   */
  async handleAddAnchor(args: any): Promise<any> {
    try {
      const { type, text, priority = 5 } = args;

      if (!text) {
        throw new Error('Anchor text is required');
      }

      const currentFrame = this.deps.frameManager.getCurrentFrameId();
      if (!currentFrame) {
        throw new Error('No active frame. Use start_frame first.');
      }

      const validTypes = [
        'FACT',
        'DECISION',
        'CONSTRAINT',
        'INTERFACE_CONTRACT',
        'TODO',
        'RISK',
      ];
      if (!validTypes.includes(type)) {
        throw new Error(
          `Invalid anchor type. Must be one of: ${validTypes.join(', ')}`
        );
      }

      this.deps.frameManager.addAnchor(type, text, priority);

      logger.info('Added anchor', { type, text, priority });

      return {
        content: [
          {
            type: 'text',
            text: `Added ${type.toLowerCase()}: ${text}`,
          },
        ],
      };
    } catch (error: unknown) {
      logger.error(
        'Error adding anchor',
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Get current hot stack context
   */
  async handleGetHotStack(args: any): Promise<any> {
    try {
      const maxEvents = args.max_events || 10;
      const hotStack = this.deps.frameManager.getHotStackContext(maxEvents);

      if (hotStack.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No active frames on the stack.',
            },
          ],
        };
      }

      const stackSummary = hotStack.map((frame, index) => ({
        depth: index,
        frameId: frame.frameId,
        goal: frame.header.goal,
        constraints: frame.header.constraints || [],
        anchors: frame.anchors.length,
        recentEvents: frame.recentEvents.length,
        artifacts: frame.activeArtifacts.length,
      }));

      return {
        content: [
          {
            type: 'text',
            text:
              `Hot Stack (${hotStack.length} frames):\n` +
              stackSummary
                .map(
                  (f: any) =>
                    `  ${f.depth}: ${f.goal} (${f.anchors} anchors, ${f.recentEvents} events)`
                )
                .join('\n'),
          },
        ],
        metadata: {
          stack: stackSummary,
        },
      };
    } catch (error: unknown) {
      logger.error(
        'Error getting hot stack',
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }
}
