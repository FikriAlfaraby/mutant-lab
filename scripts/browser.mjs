// Launches Chromium for the e2e run and for rendering images. Order: $CHROMIUM_PATH, Playwright's
// own download, then the newest Chromium already in the Playwright cache.
import { existsSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { chromium } from "playwright-core"

function cachedChromium() {
  const cache = join(homedir(), "Library/Caches/ms-playwright")
  if (!existsSync(cache)) return undefined
  const builds = readdirSync(cache)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
  for (const build of builds) {
    for (const app of ["chrome-mac-arm64/Chromium.app", "chrome-mac/Chromium.app"]) {
      const exe = join(cache, build, app, "Contents/MacOS/Chromium")
      if (existsSync(exe)) return exe
    }
  }
  return undefined
}

export async function launch(options = {}) {
  if (process.env.CHROMIUM_PATH) return chromium.launch({ ...options, executablePath: process.env.CHROMIUM_PATH })
  try {
    return await chromium.launch(options)
  } catch (err) {
    const exe = cachedChromium()
    if (!exe) throw err
    return chromium.launch({ ...options, executablePath: exe })
  }
}
