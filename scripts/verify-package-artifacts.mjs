import { accessSync, constants } from "node:fs";

const requiredArtifacts = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/cli.js",
  "dist/runtime-schemas.js",
];

for (const artifactPath of requiredArtifacts) {
  accessSync(new URL(`../${artifactPath}`, import.meta.url), constants.R_OK);
}

console.log(`Verified ${requiredArtifacts.length} build artifacts.`);
