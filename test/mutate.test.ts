import assert from "node:assert/strict"
import { test } from "node:test"

import { parse } from "acorn"

import { applyMutant, findMutants, nudge, ParseError } from "../src/engine/mutate.ts"
import { EXAMPLES } from "../src/examples.ts"

const describeAll = (source: string) =>
  findMutants(source).map((m) => `${m.operator} ${m.original}->${m.replacement} @${m.line}:${m.column}`)

test("each operator finds its change at the right place", () => {
  const source = [
    "function f(a, b, xs) {",
    "  if (a < b && !xs.some((x) => x === 2)) return Math.max(a, 0.5)",
    "  return a * b > 10 ? Math.round(a) : true",
    "}",
  ].join("\n")
  assert.deepEqual(describeAll(source), [
    "condition a < b && !xs.some((x) => x === 2)->true @2:6",
    "condition a < b && !xs.some((x) => x === 2)->false @2:6",
    "boundary <-><= @2:8",
    "logic &&->|| @2:12",
    "unary !-> @2:15",
    "someEvery some->every @2:19",
    "negate ===->!== @2:33",
    "constant 2->3 @2:37",
    "minmax max->min @2:53",
    "constant 0.5->0.6 @2:60",
    "condition a * b > 10->true @3:9",
    "condition a * b > 10->false @3:9",
    "math *->/ @3:11",
    "boundary >->>= @3:15",
    "constant 10->11 @3:17",
    "rounding round->floor @3:27",
    "rounding round->ceil @3:27",
    "bool true->false @3:38",
  ])
})

test("ids follow source order", () => {
  const ids = findMutants("const x = 1 + 2 * 3").map((m) => m.id)
  assert.deepEqual(ids, [1, 2, 3, 4, 5])
})

test("string building is not turned into subtraction", () => {
  assert.deepEqual(describeAll('const s = "n=" + n + `!`'), [])
})

test("brackets and comments between operands do not hide the operator", () => {
  const source = "const ok = (a) /* small */ < (b)"
  const [m] = findMutants(source)
  assert.ok(m)
  assert.equal(applyMutant(source, m), "const ok = (a) /* small */ <= (b)")
})

test("negative literals are nudged as numbers, not stripped of their sign", () => {
  assert.deepEqual(describeAll("const t = -15"), ["constant 15->16 @1:11"])
})

test("nudge moves the last digit by one", () => {
  assert.equal(nudge("15"), "16")
  assert.equal(nudge("0"), "1")
  assert.equal(nudge("99"), "100")
  assert.equal(nudge("0.1"), "0.2")
  assert.equal(nudge("1.15"), "1.16")
  assert.equal(nudge("100000"), "100001")
})

test("code that does not parse is reported with its line", () => {
  assert.throws(
    () => findMutants("function f() {\n  return (1 +\n}"),
    (err: unknown) => err instanceof ParseError && err.line === 3 && !/\(\d+:\d+\)/.test(err.message),
  )
})

test("every mutant of every example still parses", () => {
  for (const ex of EXAMPLES) {
    for (const m of findMutants(ex.code)) {
      const mutated = applyMutant(ex.code, m)
      assert.doesNotThrow(() => parse(mutated, { ecmaVersion: "latest" }), `${ex.id} #${m.id} ${m.original}->${m.replacement}`)
      assert.notEqual(mutated, ex.code)
    }
  }
})

test("names inherited from Object.prototype are not operators", () => {
  const source = "function digits(n) { return n.toString().length + n.valueOf() }"
  for (const m of findMutants(source)) {
    assert.doesNotMatch(m.replacement, /function|native code/, `${m.original} -> ${m.replacement}`)
  }
  assert.deepEqual(describeAll("const ok = x.hasOwnProperty('a')"), [])
})

test("a change that would glue onto its neighbour gets a space", () => {
  const plus = findMutants("const d = a+-b").find((m) => m.original === "+")
  assert.ok(plus)
  assert.equal(applyMutant("const d = a+-b", plus), "const d = a- -b")
  const not = findMutants("const t = typeof!x").find((m) => m.operator === "unary")
  assert.ok(not)
  assert.equal(applyMutant("const t = typeof!x", not), "const t = typeof x")
})

test("changes that cannot parse are dropped, and so are duplicates", () => {
  const source = "const f = !function () { return 1 }()\nconst g = !!x"
  for (const m of findMutants(source)) {
    assert.doesNotThrow(() => parse(applyMutant(source, m), { ecmaVersion: "latest" }), `${m.original} -> ${m.replacement}`)
  }
  const outputs = findMutants(source).map((m) => applyMutant(source, m))
  assert.equal(new Set(outputs).size, outputs.length)
})

test("any kind of white space may sit before an operator", () => {
  assert.deepEqual(describeAll("const ok = a < b").slice(0, 1), ["boundary <-><= @1:13"])
})

test("text built with + stays text all the way along", () => {
  assert.deepEqual(describeAll("const s = 'n=' + n + m"), [])
})

test("import and export are reported as such", () => {
  assert.throws(
    () => findMutants("export function f() {}"),
    (err: unknown) => err instanceof ParseError && err.kind === "module",
  )
})
