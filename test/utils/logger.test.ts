import { afterEach, describe, expect, it, vi } from "vitest";

import { logger } from "../../source/utils/logger.js";

afterEach(() => {
  logger.setLevel("info");
  vi.restoreAllMocks();
});

describe("logger", () => {
  it("filters messages below the current log level", () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    logger.debug("hidden");

    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("emits debug messages to stderr when the level allows them", () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    logger.setLevel("debug");
    logger.debug("visible");

    expect(stderrSpy.mock.calls[0]?.[0]).toContain("[DEBUG] visible");
  });

  it("emits info messages to stderr, not stdout", () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    logger.info("hello");

    expect(stderrSpy.mock.calls[0]?.[0]).toContain("[INFO] hello");
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("emits error messages at warn level", () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    logger.setLevel("warn");
    logger.error("boom");

    expect(errorSpy.mock.calls[0]?.[0]).toContain("[ERROR] boom");
  });
});
