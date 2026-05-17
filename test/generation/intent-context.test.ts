import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  loadIntentContext,
  maxContextFileBytes,
  truncateContext,
} from "../../source/generation/intent-context.js";

describe("intent context", () => {
  it("loads local context files as titled sections", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "jittest-context-"));
    await writeFile(
      path.join(repoRoot, "issue.md"),
      "Issue: keep refresh tokens valid.",
      "utf-8",
    );

    const context = await loadIntentContext(repoRoot, ["issue.md"]);

    expect(context).toContain("### issue.md");
    expect(context).toContain("keep refresh tokens valid");
  });

  it("truncates large context values", () => {
    const context = truncateContext("x".repeat(maxContextFileBytes + 1));

    expect(context).toHaveLength(
      maxContextFileBytes + "\n...[truncated]".length,
    );
    expect(context).toContain("[truncated]");
  });
});
