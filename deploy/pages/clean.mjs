import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Xserver's staging step leaves PHP files in dist. Pages must build from a clean output.
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
rmSync(join(root, "apps/web/dist"), { recursive: true, force: true });
