import { build } from "esbuild";
import { spawnSync } from "node:child_process";
const result = await build({
  entryPoints: ["tests/upload.test.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
});
const run = spawnSync(process.execPath, ["-"], {
  input: result.outputFiles[0].text,
  encoding: "utf8",
  stdio: ["pipe", "inherit", "inherit"],
});
if (run.error) throw run.error;
process.exit(run.status ?? 1);
