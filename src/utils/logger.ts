import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  private name: string;
  private logLevel: LogLevel;

  constructor(name: string, logLevel: LogLevel = 'info') {
    this.name = name;
    this.logLevel = (process.env.LOG_LEVEL as LogLevel) || logLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const currentIndex = levels.indexOf(this.logLevel);
    const targetIndex = levels.indexOf(level);
    return targetIndex >= currentIndex;
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    ...args: unknown[]
  ): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${this.name}] [${level.toUpperCase()}]`;

    const formattedArgs =
      args.length > 0
        ? ' ' +
          args
            .map((arg) =>
              typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
            )
            .join(' ')
        : '';

    return `${prefix} ${message}${formattedArgs}`;
  }

  public debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.log(chalk.gray(this.formatMessage('debug', message, ...args)));
    }
  }

  public info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.log(chalk.blue(this.formatMessage('info', message, ...args)));
    }
  }

  public warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(chalk.yellow(this.formatMessage('warn', message, ...args)));
    }
  }

  public error(message: string, error?: unknown): void {
    if (this.shouldLog('error')) {
      const errorDetails = error
        ? error instanceof Error
          ? `\n${error.stack || error.message}`
          : `\n${JSON.stringify(error, null, 2)}`
        : '';
      console.error(
        chalk.red(this.formatMessage('error', message) + errorDetails)
      );
    }
  }
}
