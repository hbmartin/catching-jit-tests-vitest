import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  defaultFeedbackPath,
  resolveFeedbackPath,
} from "../../source/commands/feedback-path.js";

describe("resolveFeedbackPath", () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir !== null) {
      await rm(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  it("uses an explicit feedback path", () => {
    const cwd = "/tmp/example";

    expect(
      resolveFeedbackPath({
        cwd,
        feedbackPath: "records.jsonl",
      }),
    ).toBe(path.join(cwd, "records.jsonl"));
  });

  it("reads feedback path from config", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "jittest-feedback-path-"));
    await writeFile(
      path.join(dir, "jittest.config.json"),
      JSON.stringify({ feedbackPath: "artifacts/records.jsonl" }),
      "utf-8",
    );

    expect(resolveFeedbackPath({ cwd: dir })).toBe(
      path.join(dir, "artifacts", "records.jsonl"),
    );
  });

  it("falls back to the default path", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "jittest-feedback-path-"));

    expect(resolveFeedbackPath({ cwd: dir })).toBe(
      path.join(dir, defaultFeedbackPath),
    );
  });
});
