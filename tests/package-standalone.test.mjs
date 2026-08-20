import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { packageStandalone } from "../scripts/package-standalone.mjs";

test("copies static and public assets into the standalone tree", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "package-standalone-"));
  try {
    await mkdir(path.join(root, ".next", "standalone"), { recursive: true });
    await mkdir(path.join(root, ".next", "static", "chunks"), { recursive: true });
    await mkdir(path.join(root, "public", "images"), { recursive: true });
    await writeFile(path.join(root, ".next", "static", "chunks", "app.js"), "static asset");
    await writeFile(path.join(root, "public", "images", "logo.txt"), "public asset");

    await packageStandalone(root);

    assert.equal(
      await readFile(path.join(root, ".next", "standalone", ".next", "static", "chunks", "app.js"), "utf8"),
      "static asset",
    );
    assert.equal(
      await readFile(path.join(root, ".next", "standalone", "public", "images", "logo.txt"), "utf8"),
      "public asset",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
