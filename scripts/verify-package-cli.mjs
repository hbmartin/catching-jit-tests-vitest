import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);
const tempRoot = mkdtempSync(path.join(tmpdir(), "jittest-package-cli-"));

const commandName = (command) =>
  process.platform === "win32" ? `${command}.cmd` : command;

const run = (command, args, options) => {
  const result = spawnSync(commandName(command), args, {
    encoding: "utf8",
    ...options,
  });

  if (result.error !== undefined) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(" ")} exited ${result.status ?? result.signal}`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return result;
};

const parsePackOutput = (stdout) => {
  const entries = JSON.parse(stdout);

  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`Unexpected npm pack output: ${stdout}`);
  }

  return entries[0];
};

try {
  const packResult = run(
    "npm",
    ["pack", "--json", "--pack-destination", tempRoot],
    {
      cwd: repoRoot,
    },
  );
  const packedPackage = parsePackOutput(packResult.stdout);
  const tarballPath = path.isAbsolute(packedPackage.filename)
    ? packedPackage.filename
    : path.join(tempRoot, packedPackage.filename);
  const consumerDir = path.join(tempRoot, "consumer");
  mkdirSync(consumerDir, { recursive: true });
  writeFileSync(
    path.join(consumerDir, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  );

  run("pnpm", ["add", tarballPath], { cwd: consumerDir });

  const smokeTests = [
    {
      args: ["exec", "jittest", "--help"],
      expected: "Usage",
      label: "pnpm exec jittest --help",
    },
    {
      args: ["exec", "jittest", "--version"],
      expected: packageJson.version,
      label: "pnpm exec jittest --version",
    },
    {
      args: ["exec", "jittest", "catch", "--help"],
      expected: "catch options",
      label: "pnpm exec jittest catch --help",
    },
  ];

  for (const smokeTest of smokeTests) {
    const result = run("pnpm", smokeTest.args, { cwd: consumerDir });
    const stdout = result.stdout.trim();

    if (stdout.length === 0) {
      throw new Error(`${smokeTest.label} succeeded with empty stdout.`);
    }

    if (!stdout.includes(smokeTest.expected)) {
      throw new Error(
        `${smokeTest.label} did not include ${JSON.stringify(smokeTest.expected)}.\n${stdout}`,
      );
    }
  }

  console.log(
    `Verified packed jittest CLI with pnpm (${smokeTests.length} commands).`,
  );
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}
