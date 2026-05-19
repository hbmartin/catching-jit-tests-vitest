import process from "node:process";
import manifest from "../package.json" with { type: "json" };

const packageVersion = manifest.version;
const releaseTag = process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME;

if (typeof packageVersion !== "string" || packageVersion.length === 0) {
  throw new Error("package.json must declare a non-empty version.");
}

if (releaseTag === undefined || releaseTag.length === 0) {
  console.log(`No release tag provided; package version is ${packageVersion}.`);
  process.exit(0);
}

const normalizedTag = releaseTag.replace(/^refs\/tags\//, "").replace(/^v/, "");

if (normalizedTag !== packageVersion) {
  throw new Error(
    `Release tag ${releaseTag} does not match package.json version ${packageVersion}.`,
  );
}

console.log(
  `Release tag ${releaseTag} matches package version ${packageVersion}.`,
);
