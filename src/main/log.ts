// Tiny logger that prefixes the module name.
// Never pass API keys, audio, or screenshots to these functions.

export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function createLogger(module: string): Logger {
  const prefix = `[${module}]`;
  return {
    info: (...args) => console.log(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}
