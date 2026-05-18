import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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

  it("truncates by UTF-8 bytes without splitting multibyte characters", () => {
    const context = truncateContext("é".repeat(maxContextFileBytes));
    const [prefix] = context.split("\n...[truncated]");

    expect(Buffer.byteLength(prefix ?? "", "utf8")).toBeLessThanOrEqual(
      maxContextFileBytes,
    );
    expect(prefix).not.toContain("\uFFFD");
    expect(context).toContain("[truncated]");
  });

  it("skips context files that escape the repository root", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "jittest-context-"));
    const outsideRoot = await mkdtemp(path.join(tmpdir(), "jittest-outside-"));
    await writeFile(path.join(outsideRoot, "secret.md"), "secret", "utf-8");

    const escapedContext = await loadIntentContext(repoRoot, [
      path.relative(repoRoot, path.join(outsideRoot, "secret.md")),
    ]);
    const absoluteContext = await loadIntentContext(repoRoot, [
      path.join(outsideRoot, "secret.md"),
    ]);

    expect(escapedContext).toBe("");
    expect(absoluteContext).toBe("");
  });

  it("returns empty context when the repository root cannot be resolved", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "jittest-context-"));
    await rm(repoRoot, { recursive: true, force: true });

    await expect(loadIntentContext(repoRoot, ["issue.md"])).resolves.toBe("");
  });

  it("skips symlinked context files that resolve outside the repository", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "jittest-context-"));
    const outsideRoot = await mkdtemp(path.join(tmpdir(), "jittest-outside-"));
    const outsideFile = path.join(outsideRoot, "secret.md");
    await writeFile(outsideFile, "secret", "utf-8");
    await symlink(outsideFile, path.join(repoRoot, "link.md"));

    const context = await loadIntentContext(repoRoot, ["link.md"]);

    expect(context).toBe("");
  });
});
