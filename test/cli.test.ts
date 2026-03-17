import { beforeEach, describe, expect, it, vi } from "vitest";

const { runCatchCommandMock } = vi.hoisted(() => ({
  runCatchCommandMock: vi.fn(),
}));

vi.mock("../source/commands/catch.js", () => ({
  runCatchCommand: runCatchCommandMock,
}));

import { runCli } from "../source/cli.js";
import { cliVersion } from "../source/version.js";

describe("runCli", () => {
  beforeEach(() => {
    runCatchCommandMock.mockReset();
  });

  it("prints help for empty input", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runCli([]);

    expect(writeSpy).toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it("prints the version", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runCli(["--version"]);

    expect(writeSpy).toHaveBeenCalledWith(`${cliVersion}\n`);
    writeSpy.mockRestore();
  });

  it("prints the version before dispatching subcommands", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runCli(["catch", "--version"]);

    expect(writeSpy).toHaveBeenCalledWith(`${cliVersion}\n`);
    expect(runCatchCommandMock).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it("dispatches the catch command", async () => {
    await runCli(["catch"]);

    expect(runCatchCommandMock).toHaveBeenCalled();
  });

  it("passes PR metadata through catch options", async () => {
    await runCli([
      "catch",
      "--pr-title",
      "Fix auth bug",
      "--pr-body",
      "Preserve login behavior",
    ]);

    expect(runCatchCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prTitle: "Fix auth bug",
        prBody: "Preserve login behavior",
      }),
    );
  });

  it("throws on unknown commands", async () => {
    await expect(runCli(["unknown"])).rejects.toThrow("Unknown command");
  });
});
