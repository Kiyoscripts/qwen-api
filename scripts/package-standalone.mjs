import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function requireDirectory(directory) {
  try {
    if ((await stat(directory)).isDirectory()) return;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  throw new Error(`Required build directory is missing: ${directory}`);
}

export async function packageStandalone(root = process.cwd()) {
  const nextDir = path.join(root, ".next");
  const standaloneDir = path.join(nextDir, "standalone");
  const copies = [
    [path.join(nextDir, "static"), path.join(standaloneDir, ".next", "static")],
    [path.join(root, "public"), path.join(standaloneDir, "public")],
  ];

  await requireDirectory(standaloneDir);
  for (const [source, destination] of copies) {
    await requireDirectory(source);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true, force: true });
  }
}

const isDirectRun = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  await packageStandalone();
  console.log("Copied .next/static and public into .next/standalone");
}
