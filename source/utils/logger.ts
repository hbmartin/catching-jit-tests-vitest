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

// info/debug write to stderr (not stdout) so that stdout carries only command
// output — keeping `--output json` and `| jq` pipelines parseable. warn/error
// already go to stderr via console.warn/console.error.
function debug(message: string): void {
  if (shouldLog("debug")) {
    process.stderr.write(`${formatMessage("debug", message)}\n`);
  }
}

function info(message: string): void {
  if (shouldLog("info")) {
    process.stderr.write(`${formatMessage("info", message)}\n`);
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
