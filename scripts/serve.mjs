// A small static file server for the demo and the e2e run. Usage: node scripts/serve.mjs [dir] [port]
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, join, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".jpg": "image/jpeg",
  ".png": "image/png",
}

export async function serve(dir, port = 0) {
  const root = resolve(dir)
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname))
    const file = join(root, path.endsWith("/") ? `${path}index.html` : path)
    if (!file.startsWith(root)) return res.writeHead(403).end("forbidden")
    try {
      const body = await readFile(file)
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" })
      res.end(body)
    } catch {
      res.writeHead(404).end("not found")
    }
  })
  await new Promise((r) => server.listen(port, "127.0.0.1", r))
  return { server, url: `http://127.0.0.1:${server.address().port}` }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await serve(process.argv[2] ?? "dist", Number(process.argv[3] ?? 4180))
  console.log(`serving ${process.argv[2] ?? "dist"} at ${url}/mutants/`)
}
