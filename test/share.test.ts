import assert from "node:assert/strict"
import { test } from "node:test"

import { decodeShare, encodeShare } from "../src/ui/share.ts"

test("a shared link round-trips code with any characters", () => {
  const shared = { code: 'const s = "Rp 1.500.000,50 — ✓"\n', tests: "test('x', () => {})\n" }
  const fragment = encodeShare(shared)
  assert.match(fragment, /^[A-Za-z0-9_-]+$/)
  assert.deepEqual(decodeShare(fragment), shared)
})

test("a damaged or foreign fragment is refused, not half-loaded", () => {
  assert.equal(decodeShare("%%%"), null)
  assert.equal(decodeShare(encodeShare({ code: "x", tests: "y" }).slice(0, 10)), null)
  assert.equal(decodeShare(btoa(JSON.stringify({ code: 1, tests: "y" }))), null)
})
