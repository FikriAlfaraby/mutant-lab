// Bundles the lab into three files: mutant-lab.js, mutant-lab-worker.js and mutant-lab.css.
// Usage: node scripts/build.mjs [--out <dir>]   (default: dist/, which also gets the demo page)
import { copyFile, mkdir } from "node:fs/promises"

import { build } from "esbuild"

const outIndex = process.argv.indexOf("--out")
const outdir = outIndex > 0 ? process.argv[outIndex + 1] : "dist"
if (!outdir) throw new Error("--out needs a directory")

const shared = { bundle: true, minify: true, target: "es2022", outdir, logLevel: "info", legalComments: "eof" }

await build({
  ...shared,
  entryPoints: { "mutant-lab": "src/main.ts", "mutant-lab-worker": "src/worker.ts" },
  format: "iife",
})
await build({ ...shared, entryPoints: { "mutant-lab": "src/ui/lab.css" } })

if (outdir === "dist") {
  await mkdir("dist/mutants", { recursive: true })
  await copyFile("demo/index.html", "dist/mutants/index.html")
}
