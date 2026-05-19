import { afterEach, describe, expect, it, vi } from "vitest";

import { logger } from "../../source/utils/logger.js";

afterEach(() => {
  logger.setLevel("info");
  vi.restoreAllMocks();
});

describe("logger", () => {
  it("filters messages below the current log level", () => {
    const debugSpy = vi
      .spyOn(console, "debug")
      .mockImplementation(() => undefined);

    logger.debug("hidden");

    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("emits debug messages when the level allows them", () => {
    const debugSpy = vi
      .spyOn(console, "debug")
      .mockImplementation(() => undefined);

    logger.setLevel("debug");
    logger.debug("visible");

    expect(debugSpy.mock.calls[0]?.[0]).toContain("[DEBUG] visible");
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
