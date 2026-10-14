// End-to-end check of the lab on its host page, in a real browser.
// Usage: node scripts/e2e.mjs [--site <dir with mutants/index.html> | --url <origin>] [--video <file.mp4>]
// Default site: dist (npm run build makes dist/mutants/ a demo host page). To test the real
// host, build into it and pass --site ../fikrialfaraby-site/public.
// --video records the run through Chrome's screencast and encodes it with the system ffmpeg.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { launch } from "./browser.mjs"
import { serve } from "./serve.mjs"

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : fallback
}
const root = resolve(arg("--site", "dist"))
const videoFile = arg("--video", undefined)
const pause = (ms) => new Promise((r) => setTimeout(r, videoFile ? ms : 0))

// --url checks a deployed copy instead of serving a local build.
const live = arg("--url", undefined)
const { server, url: base } = live ? { server: null, url: live.replace(/\/$/, "") } : await serve(root)

const browser = await launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await context.newPage()
const frames = []
if (videoFile) {
  const cdp = await context.newCDPSession(page)
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    frames.push({ data, at: metadata.timestamp })
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined)
  })
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: 1280, maxHeight: 800 })
}
const problems = []
page.on("console", (msg) => msg.type() === "error" && problems.push(`console: ${msg.text()}`))
page.on("pageerror", (err) => problems.push(`page: ${err.message}`))

const title = page.locator(".ml-score__title")
const expectTitle = async (text) => {
  await page.waitForFunction((t) => document.querySelector(".ml-score__title")?.textContent === t, text, { timeout: 15000 })
  assert.equal(await title.textContent(), text)
}
const run = async () => {
  await page.getByRole("button", { name: /Break (the code|it again)/ }).click()
}

try {
  await page.goto(`${base}/mutants/`)
  await page.getByRole("tab", { name: "Session merger" }).waitFor()
  await pause(1200)

  // 1. The Terminal-Bench copy: five changes slip through, the reported bug is shown first.
  await run()
  await expectTitle("Your tests caught 29 of 34 changes.")
  assert.equal(await page.locator(".ml-card").count(), 5)
  const first = page.locator(".ml-card").first()
  assert.match(await first.getAttribute("class"), /ml-card--noted/)
  assert.match(await first.textContent(), /This is the bug I found in Terminal-Bench/)
  assert.equal(await page.locator(".cm-content .ml-mark").count() > 0, true, "missed changes are underlined in the code")
  await page.locator(".ml-score").scrollIntoViewIfNeeded()
  await pause(2500)
  await first.scrollIntoViewIfNeeded()
  await pause(2500)

  // 2. The upstream test catches the two merge bugs; the gap test catches the rest.
  await page.getByRole("button", { name: "Add the test I proposed upstream" }).click()
  await expectTitle("Your tests caught 31 of 34 changes.")
  await page.locator(".ml-score").scrollIntoViewIfNeeded()
  await pause(2000)
  await page.getByRole("button", { name: "Add a test at the exact gap" }).click()
  await expectTitle("Your tests caught all 34 changes.")
  assert.equal(await page.locator(".ml-card").count(), 0)
  await pause(2500)

  // 3. Free shipping: boundary and rounding; the rupiah parser: everything caught.
  await page.getByRole("tab", { name: "Free shipping" }).click()
  await run()
  await expectTitle("Your tests caught 11 of 15 changes.")
  await pause(2000)
  await page.getByRole("tab", { name: "Rupiah parser" }).click()
  await run()
  await expectTitle("Your tests caught all 14 changes.")
  await pause(1500)

  // 4. A loop that never ends is stopped, not hung on.
  await page.getByRole("tab", { name: "Your own code" }).click()
  const editor = page.locator(".ml-pane").first().locator(".cm-content")
  await editor.click()
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.insertText("function steps(n) {\n  let s = 0\n  while (n > 1) {\n    n = n % 2 === 0 ? n / 2 : 3 * n + 1\n    s += 1\n  }\n  return s\n}\n")
  const tests = page.locator(".ml-pane").nth(1).locator(".cm-content")
  await tests.click()
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.insertText('test("6 takes 8 steps", () => {\n  expect(steps(6)).toBe(8)\n})\n')
  const started = Date.now()
  await run()
  await expectTitle("Your tests caught all 16 changes.")
  assert.ok(Date.now() - started < 8000, `endless loops took ${Date.now() - started} ms`)
  assert.ok((await page.locator(".ml-caught li", { hasText: "never finished" }).count()) > 0)

  assert.deepEqual(problems, [])
  console.log("e2e: PASS")
} finally {
  await context.close()
  await browser.close()
  server?.close()
}

if (videoFile && frames.length) {
  // Screencast frames arrive only when something repaints; each one lasts until the next.
  const dir = await mkdtemp(join(tmpdir(), "mutant-lab-video-"))
  const list = []
  for (const [i, frame] of frames.entries()) {
    const name = join(dir, `f${String(i).padStart(5, "0")}.jpg`)
    await writeFile(name, Buffer.from(frame.data, "base64"))
    const next = frames[i + 1]?.at ?? frame.at + 1.5
    list.push(`file '${name}'`, `duration ${Math.max(0.04, next - frame.at).toFixed(3)}`)
  }
  list.push(`file '${join(dir, `f${String(frames.length - 1).padStart(5, "0")}.jpg`)}'`)
  await writeFile(join(dir, "list.txt"), list.join("\n"))
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"),
    "-vf", "scale=960:-2,fps=24,format=yuv420p", "-c:v", "libx264", "-crf", "28", "-movflags", "+faststart", resolve(videoFile)])
  console.log(`video: ${videoFile} (${frames.length} frames)`)
}
