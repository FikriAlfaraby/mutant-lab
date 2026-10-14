import assert from "node:assert/strict"
import { test } from "node:test"

import { expect } from "../src/engine/expect.ts"
import { baselineProblem, judge, runSuite } from "../src/engine/suite.ts"
import { TIMED_OUT } from "../src/engine/types.ts"

const CODE = "function add(a, b) { return a + b }"

test("tests see the code's functions and report each result", () => {
  const out = runSuite(CODE, 'test("adds", () => expect(add(1, 2)).toBe(3))\ntest("wrong", () => expect(add(1, 2)).toBe(4))')
  assert.deepEqual(out, {
    tests: [
      { name: "adds", passed: true },
      { name: "wrong", passed: false, message: "expected 4, got 3" },
    ],
  })
})

test("code that throws while loading never reaches the tests", () => {
  const out = runSuite("throw new Error('boom')", 'test("t", () => {})')
  assert.deepEqual(out, { setupError: "boom", tests: [] })
})

test("a syntax error in the tests is a setup error", () => {
  const out = runSuite(CODE, "test(")
  assert.match(out.setupError ?? "", /^SyntaxError/)
})

test("async tests are refused instead of passing silently", () => {
  const out = runSuite(CODE, 'test("later", async () => expect(1).toBe(2))')
  assert.deepEqual(out.tests, [{ name: "later", passed: false, message: "async tests are not supported here" }])
})

test("judge: a failing test catches the mutant and names the test", () => {
  const verdict = judge({ tests: [{ name: "a", passed: true }, { name: "b", passed: false, message: "x" }] })
  assert.deepEqual(verdict, { status: "caught", by: "test", test: "b", message: "x" })
})

test("judge: crash, timeout and all-green", () => {
  assert.deepEqual(judge({ setupError: "boom", tests: [] }), { status: "caught", by: "crash", message: "boom" })
  assert.deepEqual(judge(TIMED_OUT), { status: "caught", by: "timeout" })
  assert.deepEqual(judge({ tests: [{ name: "a", passed: true }] }), { status: "missed" })
})

test("baseline: the original code must pass its own tests", () => {
  assert.equal(baselineProblem({ tests: [{ name: "a", passed: true }] }), null)
  assert.deepEqual(baselineProblem({ tests: [] }), { kind: "no-tests" })
  assert.deepEqual(baselineProblem(TIMED_OUT), { kind: "timeout" })
  assert.deepEqual(baselineProblem({ setupError: "boom", tests: [] }), { kind: "crash", detail: "boom" })
  assert.deepEqual(baselineProblem({ tests: [{ name: "a", passed: false, message: "no" }] }), { kind: "failing", test: "a", detail: "no" })
})

test("expect matchers pass and fail with readable messages", () => {
  expect([1, { a: 2 }]).toEqual([1, { a: 2 }])
  expect(0.1 + 0.2).toBeCloseTo(0.3)
  expect("rupiah").toContain("rup")
  expect([{ a: 1 }]).toContain({ a: 1 })
  expect(() => JSON.parse("{")).toThrow()
  expect([1, 2]).toHaveLength(2)
  assert.throws(() => expect({ a: 1 }).toEqual({ a: 2 }), /expected \{"a":2\}, got \{"a":1\}/)
  assert.throws(() => expect(NaN).toBe(0), /expected 0, got NaN/)
  assert.throws(() => expect(() => 1).toThrow(), /returned normally/)
  assert.throws(() => expect("x").toBeGreaterThan(1), /expected a number/)
})

test("toEqual compares sets, maps, dates and errors by what they hold", () => {
  expect(new Set([2, 4])).toEqual(new Set([4, 2]))
  assert.throws(() => expect(new Set([2, 4])).toEqual(new Set([1, 3])))
  expect(new Map([["a", 1]])).toEqual(new Map([["a", 1]]))
  assert.throws(() => expect(new Map([["a", 1]])).toEqual(new Map([["a", 2]])))
  assert.throws(() => expect(new Date(0)).toEqual(new Date(1)))
  assert.throws(() => expect(new Error("a")).toEqual(new Error("b")))
  assert.throws(() => expect([1]).toEqual({ 0: 1 }))
})

test(".not, the extra matchers and an unknown matcher", () => {
  expect(1).not.toBe(2)
  assert.throws(() => expect(1).not.toBe(1), /expected not/)
  expect(null).toBeNull()
  expect("rupiah").toMatch(/^rup/)
  expect(() => {
    throw new Error("budget missing")
  }).toThrow("budget")
  assert.throws(() => expect(() => { throw new Error("x") }).toThrow("budget"), /expected an error matching/)
  assert.throws(() => (expect(1) as unknown as Record<string, () => void>).toBeNaN?.(), /toBeNaN is not supported here/)
})

test("an unknown matcher fails the test with a clear message", () => {
  const out = runSuite("function f() { return 1 }", 'test("t", () => expect(f()).toBeOne())')
  assert.match(out.tests[0]?.message ?? "", /toBeOne is not supported here/)
})
