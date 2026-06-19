import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

async function writeOutputFile(
  cwd: string,
  outputPath: string,
  content: string,
): Promise<void> {
  const resolved = path.resolve(cwd, outputPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, content, "utf-8");
}

export { writeOutputFile };
