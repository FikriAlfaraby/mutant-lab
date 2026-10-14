import assert from "node:assert/strict"
import { test } from "node:test"

import { findMutants } from "../src/engine/mutate.ts"
import { baselineProblem, runSuite } from "../src/engine/suite.ts"
import { analyseSync } from "../src/engine/sync.ts"
import { EXAMPLES, noteFor } from "../src/examples.ts"
import type { Example } from "../src/examples.ts"

function example(id: string): Example {
  const ex = EXAMPLES.find((e) => e.id === id)
  assert.ok(ex, id)
  return ex
}

function missed(ex: Example, tests = ex.tests): string[] {
  return analyseSync(ex.code, tests, findMutants(ex.code))
    .filter((r) => r.verdict.status === "missed")
    .map(({ mutant: m }) => `${m.operator} ${m.original}->${m.replacement} @${m.line}`)
}

const withFixes = (ex: Example, ...indexes: number[]) =>
  [ex.tests, ...indexes.map((i) => ex.fixes[i]?.code ?? assert.fail(`no fix ${i}`))].join("\n")

test("every example passes its own tests before anything is changed", () => {
  for (const ex of EXAMPLES) {
    assert.equal(baselineProblem(runSuite(ex.code, ex.tests)), null, ex.id)
    assert.equal(baselineProblem(runSuite(ex.code, withFixes(ex, ...ex.fixes.keys()))), null, `${ex.id} with fixes`)
  }
})

test("session merger: the five changes its tests miss, as the page describes them", () => {
  const ex = example("sessions")
  assert.equal(findMutants(ex.code).length, 34)
  assert.deepEqual(missed(ex), [
    "constant 15->16 @1",
    "boundary >=->> @6",
    "boundary <=->< @6",
    "minmax min->max @26",
    "minmax max->min @27",
  ])
})

test("session merger: the upstream test catches the merge bugs, the gap test the rest", () => {
  const ex = example("sessions")
  assert.deepEqual(missed(ex, withFixes(ex, 0)), ["constant 15->16 @1", "boundary >=->> @6", "boundary <=->< @6"])
  assert.deepEqual(missed(ex, withFixes(ex, 1)), ["minmax min->max @26", "minmax max->min @27"])
  assert.deepEqual(missed(ex, withFixes(ex, 0, 1)), [])
})

test("session merger: the Terminal-Bench note sits on exactly one mutant, the end time", () => {
  const ex = example("sessions")
  const lines = ex.code.split("\n")
  const noted = findMutants(ex.code).filter((m) => noteFor(ex, lines[m.line - 1] ?? "", m.original, m.replacement))
  assert.deepEqual(noted.map((m) => `${m.original}->${m.replacement} @${m.line}`), ["max->min @27"])
})

test("free shipping: boundary and rounding slip through until their tests are added", () => {
  const ex = example("checkout")
  assert.deepEqual(missed(ex), [
    "rounding round->floor @3",
    "rounding round->ceil @3",
    "boundary >=->> @5",
    "constant 100000->100001 @5",
  ])
  assert.deepEqual(missed(ex, withFixes(ex, 0)), ["rounding round->floor @3", "rounding round->ceil @3"])
  assert.deepEqual(missed(ex, withFixes(ex, 0, 1)), [])
})

test("rupiah parser: every change is caught", () => {
  const ex = example("rupiah")
  assert.equal(findMutants(ex.code).length, 14)
  assert.deepEqual(missed(ex), [])
})

test("your own code: 1900 and 2000 are the missing tests", () => {
  const ex = example("own")
  assert.equal(missed(ex).length, 6)
  const more = `${ex.tests}\ntest("1900 is not", () => expect(isLeapYear(1900)).toBe(false))\ntest("2000 is", () => expect(isLeapYear(2000)).toBe(true))`
  assert.deepEqual(missed(ex, more), [])
})

test("the session example still makes exactly the 34 changes the page and the home card quote", () => {
  const ex = example("sessions")
  const outputs = findMutants(ex.code)
  assert.equal(outputs.length, 34)
})
