import path from "node:path";

import { type CalibrateCommandOptions, loadConfigFile } from "../config.js";

const defaultFeedbackPath = ".jittest/assessment-records.jsonl";

function resolveFeedbackPath(
  options: Pick<CalibrateCommandOptions, "cwd" | "configPath" | "feedbackPath">,
): string {
  if (options.feedbackPath !== undefined) {
    return path.resolve(options.cwd, options.feedbackPath);
  }

  const fileConfig = loadConfigFile(options.cwd, options.configPath);
  // biome-ignore lint/complexity/useLiteralKeys: index signature access
  const fileFeedbackPath = fileConfig["feedbackPath"];
  const fromFile =
    typeof fileFeedbackPath === "string"
      ? fileFeedbackPath
      : defaultFeedbackPath;
  return path.resolve(options.cwd, fromFile);
}

export { defaultFeedbackPath, resolveFeedbackPath };
