import { beforeEach, describe, expect, it, vi } from "vitest";

const { runCatchCommandMock } = vi.hoisted(() => ({
  runCatchCommandMock: vi.fn(),
}));

vi.mock("../source/commands/catch.js", () => ({
  runCatchCommand: runCatchCommandMock,
}));

import { runCli } from "../source/cli.js";

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

    expect(writeSpy).toHaveBeenCalledWith("0.1.0\n");
    writeSpy.mockRestore();
  });

  it("dispatches the catch command", async () => {
    await runCli(["catch"]);

    expect(runCatchCommandMock).toHaveBeenCalled();
  });

  it("throws on unknown commands", async () => {
    await expect(runCli(["unknown"])).rejects.toThrow("Unknown command");
  });
});
