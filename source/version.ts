import { readFileSync } from "node:fs";

interface PackageManifest {
  readonly version?: unknown;
}

const packageManifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as PackageManifest;

if (
  typeof packageManifest.version !== "string" ||
  packageManifest.version.length === 0
) {
  throw new Error("package.json must declare a non-empty version.");
}

export const cliVersion = packageManifest.version;
