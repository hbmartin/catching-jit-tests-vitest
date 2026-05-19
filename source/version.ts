import packageManifest from "../package.json" with { type: "json" };

export interface PackageManifest {
  readonly version?: unknown;
}

export function packageManifestVersion(manifest: PackageManifest): string {
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error("package.json must declare a non-empty version.");
  }

  return manifest.version;
}

export const cliVersion = packageManifestVersion(packageManifest);
