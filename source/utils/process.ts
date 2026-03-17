// biome-ignore lint/correctness/noNodejsModules: process utilities require Node child_process APIs.
import { execFile } from "node:child_process";
// biome-ignore lint/correctness/noNodejsModules: process utilities require Node util APIs.
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface RunCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
  timeout?: number;
}

interface RunCommandResult {
  stdout: string;
  stderr: string;
}

class CommandError extends Error {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly errorCode: string | null;

  constructor(
    message: string,
    options: {
      stdout: string;
      stderr: string;
      exitCode: number | null;
      errorCode: string | null;
      cause: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "CommandError";
    this.stdout = options.stdout;
    this.stderr = options.stderr;
    this.exitCode = options.exitCode;
    this.errorCode = options.errorCode;
  }
}

const buildFailureMessage = (
  command: string,
  args: readonly string[],
  stderr: string,
): string => {
  const renderedCommand = [command, ...args].join(" ");
  const renderedStderr = stderr.trim();

  if (renderedStderr.length > 0) {
    return `Command failed: ${renderedCommand}\n${renderedStderr}`;
  }

  return `Command failed: ${renderedCommand}`;
};

export const runCommand = async (
  command: string,
  args: readonly string[],
  options: RunCommandOptions = {},
): Promise<RunCommandResult> => {
  try {
    const result = await execFileAsync(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      maxBuffer: options.maxBuffer,
      timeout: options.timeout,
      encoding: "utf8",
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const failedResult = error as {
      code?: number | string | null;
      stderr?: string | Buffer;
      stdout?: string | Buffer;
    };

    const stdout = failedResult.stdout?.toString() ?? "";
    const stderr = failedResult.stderr?.toString() ?? "";
    const exitCode =
      typeof failedResult.code === "number" ? failedResult.code : null;
    const errorCode =
      typeof failedResult.code === "string" ? failedResult.code : null;

    throw new CommandError(buildFailureMessage(command, args, stderr), {
      stdout,
      stderr,
      exitCode,
      errorCode,
      cause: error,
    });
  }
};

export type { RunCommandOptions, RunCommandResult };
export { CommandError };
