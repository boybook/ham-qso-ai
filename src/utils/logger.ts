/**
 * Logger interface. Allows injecting external loggers.
 */
export interface ILogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Default console-based logger with module prefix.
 */
class ConsoleLogger implements ILogger {
  constructor(private readonly module: string) {}

  debug(message: string, ...args: unknown[]): void {
    console.debug(`[ham-qso-ai:${this.module}]`, message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    console.info(`[ham-qso-ai:${this.module}]`, message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(`[ham-qso-ai:${this.module}]`, message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    console.error(`[ham-qso-ai:${this.module}]`, message, ...args);
  }
}

/**
 * Create a logger instance. Uses the provided logger or creates a default console logger.
 */
export function createLogger(module: string, logger?: ILogger): ILogger {
  if (logger) return logger;
  return new ConsoleLogger(module);
}
