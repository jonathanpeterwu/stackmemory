/**
 * WebSocket Client
 * Real-time data streaming for TUI dashboard
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
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

export class WebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;

  constructor(url: string) {
    super();
    this.url = url;
  }

  async connect(): Promise<void> {
    return new Promise((resolve) => {
      try {
        // Add error handler before creating WebSocket to catch connection errors
        const handleError = (error: Error) => {
          clearTimeout(connectionTimeout);
          // Silent error handling - continue in offline mode
          if (process.env['DEBUG']) {
            console.log('WebSocket connection failed:', error.message);
          }
          if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.terminate();
            this.ws = null;
          }
          resolve(); // Always resolve to continue in offline mode
        };

        // Set a timeout for connection
        const connectionTimeout = setTimeout(() => {
          if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.terminate();
            this.ws = null;
          }
          console.log('⚠️  Running in offline mode (no WebSocket server)');
          this.emit('offline');
          resolve();
        }, 1000); // Reduce timeout to 1 second

        try {
          this.ws = new WebSocket(this.url);
        } catch (wsError: unknown) {
          handleError(wsError as Error);
          return;
        }

        // Immediately add error handler to catch connection errors
        this.ws.once('error', handleError);

        this.ws.once('open', () => {
          clearTimeout(connectionTimeout);
          // Remove the error handler and add a new one for ongoing errors
          this.ws?.removeListener('error', handleError);
          this.ws?.on('error', (error: Error) => {
            if (process.env['DEBUG']) {
              console.error('WebSocket error during operation:', error);
            }
            this.emit('error', error);
          });

          console.log('✅ WebSocket connected');
          this.reconnectAttempts = 0;
          this.emit('connected');
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.once('close', () => {
          clearTimeout(connectionTimeout);
          if (this.reconnectAttempts > 0) {
            console.log('WebSocket disconnected');
            this.emit('disconnected');
            this.attemptReconnect();
          }
          // If this is the first close, just resolve
          resolve();
        });
      } catch (error: unknown) {
        // If anything fails, continue in offline mode
        console.log('⚠️  Running in offline mode');
        this.emit('offline');
        resolve();
      }
    });
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'session:update':
          this.emit('session:update', message.data);
          break;

        case 'task:update':
          this.emit('task:update', message.data);
          break;

        case 'frame:update':
          this.emit('frame:update', message.data);
          break;

        case 'agent:status':
          this.emit('agent:status', message.data);
          break;

        case 'pr:update':
          this.emit('pr:update', message.data);
          break;

        case 'analytics:update':
          this.emit('analytics:update', message.data);
          break;

        case 'notification':
          this.emit('notification', message.data);
          break;

        default:
          this.emit('message', message);
      }
    } catch (error: unknown) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('error', new Error('Max reconnection attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(
      `Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error) => {
        console.error('Reconnection failed:', error);
      });
    }, delay);
  }

  send(type: string, data: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    } else {
      console.warn('WebSocket is not connected');
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
