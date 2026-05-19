import { describe, expect, it } from "vitest";

import packageManifest from "../package.json" with { type: "json" };
import { cliVersion, packageManifestVersion } from "../source/version.js";

describe("version", () => {
  it("uses the package manifest version", () => {
    expect(cliVersion).toBe(packageManifest.version);
  });

  it("rejects a missing package manifest version", () => {
    expect(() => packageManifestVersion({})).toThrow(
      "package.json must declare a non-empty version.",
    );
  });

  it("rejects an empty package manifest version", () => {
    expect(() => packageManifestVersion({ version: "" })).toThrow(
      "package.json must declare a non-empty version.",
    );
  });
});
