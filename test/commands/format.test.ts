import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  renderReport,
  runFormatCommand,
} from "../../source/commands/format.js";
import {
  formatJsonReport,
  jsonReportSchema,
} from "../../source/reporting/json-report.js";

describe("runFormatCommand", () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir !== null) {
      await rm(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  it("renders a saved JSON report to a GitHub step summary file", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "jittest-format-"));
    await writeFile(
      path.join(dir, "report.json"),
      formatJsonReport([], null, "No matching changed files."),
      "utf-8",
    );

    await runFormatCommand({
      input: "report.json",
      output: "github-step-summary",
      outFile: "summary.md",
      cwd: dir,
    });

    await expect(
      readFile(path.join(dir, "summary.md"), "utf-8"),
    ).resolves.toContain("No matching changed files.");
  });

  it("writes rendered output to stdout by default", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "jittest-format-"));
    await writeFile(
      path.join(dir, "report.json"),
      formatJsonReport([], null, "Skipped."),
      "utf-8",
    );
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      await runFormatCommand({
        input: "report.json",
        output: "github-step-summary",
        cwd: dir,
      });

      expect(writeSpy).toHaveBeenCalledWith(
        expect.stringContaining("Skipped."),
      );
    } finally {
      writeSpy.mockRestore();
    }
  });
});

describe("renderReport", () => {
  const report = jsonReportSchema.parse(
    JSON.parse(formatJsonReport([], null, "Skipped.")),
  );

  it("renders JSON reports", () => {
    expect(renderReport(report, "json")).toContain(
      '"statusMessage": "Skipped."',
    );
  });

  it("renders GitHub comments", () => {
    expect(renderReport(report, "github-comment")).toContain(
      "## JiTTest: Status",
    );
  });

  it("rejects console rendering for saved reports", () => {
    expect(() => renderReport(report, "console")).toThrow(
      "Cannot render saved report as console",
    );
  });
});
