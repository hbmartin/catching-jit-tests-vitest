type LogLevel = "debug" | "info" | "warn" | "error";

const levelOrder: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

function setLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return levelOrder[level] >= levelOrder[currentLevel];
}

function formatMessage(level: LogLevel, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
}

function debug(message: string): void {
  if (shouldLog("debug")) {
    console.debug(formatMessage("debug", message));
  }
}

function info(message: string): void {
  if (shouldLog("info")) {
    console.info(formatMessage("info", message));
  }
}

function warn(message: string): void {
  if (shouldLog("warn")) {
    console.warn(formatMessage("warn", message));
  }
}

function error(message: string): void {
  if (shouldLog("error")) {
    console.error(formatMessage("error", message));
  }
}

const logger = { debug, info, warn, error, setLevel };

export type { LogLevel };
export { logger };
