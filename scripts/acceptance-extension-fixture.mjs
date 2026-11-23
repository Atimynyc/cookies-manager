import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".tmp",
  "docs",
  "node_modules",
  "output",
  "release",
  "scripts",
  "tests"
]);

export async function createAcceptanceExtension(projectRoot, { hostPermissions } = {}) {
  const extensionRoot = await mkdtemp(path.join(os.tmpdir(), "cookie-controller-extension-"));
  await cp(projectRoot, extensionRoot, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(projectRoot, source);
      const firstSegment = relative.split(path.sep)[0];
      return !EXCLUDED_DIRECTORIES.has(firstSegment);
    }
  });

  const manifestPath = path.join(extensionRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.host_permissions = hostPermissions ?? manifest.optional_host_permissions;
  if (!hostPermissions) delete manifest.optional_host_permissions;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    extensionRoot,
    async cleanup() {
      await rm(extensionRoot, { recursive: true, force: true });
    }
  };
}
