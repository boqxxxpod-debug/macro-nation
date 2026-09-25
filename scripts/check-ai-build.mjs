import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = new URL("../apps/web/dist/", import.meta.url).pathname;
function files(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
const assets = files(dist).filter((file) => /\.(?:js|html)$/.test(file));
if (!assets.length) throw new Error("Build assets missing");
for (const file of assets) {
  if (/OPENAI_API_KEY|sk-[a-zA-Z0-9_-]{20,}/.test(readFileSync(file, "utf8"))) {
    throw new Error(`Potential API secret in public asset: ${file}`);
  }
}
if (!files(join(dist, "api")).some((file) => file.endsWith("ai.php"))) throw new Error("Xserver proxy missing");
if (!existsSync(join(dist, "api/_private/.htaccess")) || !readFileSync(join(dist, "api/_private/.htaccess"), "utf8").includes("Require all denied")) throw new Error("Private AI files are not protected");
console.log("AI assets: no key reference in browser bundle; PHP proxy staged");
