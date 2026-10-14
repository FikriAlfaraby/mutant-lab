import { expect } from "./expect.ts"
import { TIMED_OUT } from "./types.ts"
import type { RunOutcome, SuiteResult, TestResult, Verdict } from "./types.ts"

type TestFn = () => unknown

/**
 * Runs `tests` against `code` in one scope, the way the page runs them inside a worker.
 * The code's top-level functions are visible to the tests; `test` and `expect` are provided.
 */
export function runSuite(code: string, tests: string): SuiteResult {
  const registered: { name: string; fn: TestFn }[] = []
  const test = (name: string, fn: TestFn) => {
    registered.push({ name: String(name), fn })
  }
  try {
    const load = new Function("test", "expect", `"use strict";\n${code}\n;\n${tests}`)
    load(test, expect)
  } catch (err) {
    return { setupError: describe(err), tests: [] }
  }
  const results: TestResult[] = registered.map(({ name, fn }) => {
    try {
      const out = fn()
      if (out instanceof Promise) {
        // Its result would arrive after the verdict; drop it so it cannot surface later as an error.
        out.catch(() => undefined)
        return { name, passed: false, message: "async tests are not supported here" }
      }
      return { name, passed: true }
    } catch (err) {
      return { name, passed: false, message: describe(err) }
    }
  })
  return { tests: results }
}

/** A mutant is caught when any test fails, the code crashes while loading, or the run hangs. */
export function judge(outcome: RunOutcome): Verdict {
  if (outcome === TIMED_OUT) return { status: "caught", by: "timeout" }
  if (outcome.setupError !== undefined) return { status: "caught", by: "crash", message: outcome.setupError }
  const failed = outcome.tests.find((t) => !t.passed)
  if (failed) return { status: "caught", by: "test", test: failed.name, message: failed.message ?? "" }
  return { status: "missed" }
}

export type BaselineProblem =
  | { kind: "timeout" }
  | { kind: "no-tests" }
  | { kind: "crash"; detail: string }
  | { kind: "failing"; test: string; detail: string }

/** The original code must pass its own tests before any mutant means anything. */
export function baselineProblem(outcome: RunOutcome): BaselineProblem | null {
  if (outcome === TIMED_OUT) return { kind: "timeout" }
  if (outcome.setupError !== undefined) return { kind: "crash", detail: outcome.setupError }
  if (outcome.tests.length === 0) return { kind: "no-tests" }
  const failed = outcome.tests.find((t) => !t.passed)
  return failed ? { kind: "failing", test: failed.name, detail: failed.message ?? "" } : null
}

export function describe(err: unknown): string {
  if (err instanceof Error) return err.name === "AssertionError" || err.name === "Error" ? err.message : `${err.name}: ${err.message}`
  return String(err)
}
