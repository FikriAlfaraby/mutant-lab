import { parse } from "acorn"
import { full } from "acorn-walk"
import type { AnyNode } from "acorn"

import type { Mutant, OperatorId } from "./types.ts"

/** A change before it gets an id and a position on the line. */
type Site = Pick<Mutant, "operator" | "start" | "end" | "original" | "replacement">

const BOUNDARY: Record<string, string> = { "<": "<=", "<=": "<", ">": ">=", ">=": ">" }
const NEGATE: Record<string, string> = { "===": "!==", "!==": "===", "==": "!=", "!=": "==" }
const MATH: Record<string, string> = { "+": "-", "-": "+", "*": "/", "/": "*", "%": "*" }
const LOGIC: Record<string, string> = { "&&": "||", "||": "&&" }
const MINMAX: Record<string, string> = { min: "max", max: "min" }
const ROUNDING: Record<string, string[]> = { round: ["floor", "ceil"], floor: ["ceil"], ceil: ["floor"] }
const SOME_EVERY: Record<string, string> = { some: "every", every: "some" }

/** Own keys only: a name like "toString" must not find Object.prototype.toString. */
function lookup<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined
}

export class ParseError extends Error {
  readonly line: number
  readonly column: number
  /** "module" when the code uses import or export, which the lab cannot run. */
  readonly kind: "syntax" | "module"

  constructor(message: string, line: number, column: number, kind: "syntax" | "module" = "syntax") {
    super(message)
    this.name = "ParseError"
    this.line = line
    this.column = column
    this.kind = kind
  }
}

function parseScript(source: string): AnyNode {
  return parse(source, { ecmaVersion: "latest", sourceType: "script" })
}

/**
 * Every small change the lab can make to `source`, in source order. Each one is applied and
 * parsed again: a change that would not parse, or that gives the same code as another change,
 * is dropped. Throws ParseError when the source itself does not parse.
 */
export function findMutants(source: string): Mutant[] {
  let program: AnyNode
  try {
    program = parseScript(source)
  } catch (err) {
    const loc = (err as { loc?: { line: number; column: number } }).loc
    const message = err instanceof Error ? err.message.replace(/\s*\(\d+:\d+\)$/, "") : String(err)
    const kind = /sourceType: module/.test(message) ? "module" : "syntax"
    throw new ParseError(message, loc?.line ?? 1, loc?.column ?? 0, kind)
  }

  const sites: Site[] = []
  full(program, (node) => {
    sites.push(...sitesFor(node, source))
  })

  const seen = new Set<string>([source])
  return sites
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .filter((site) => {
      const mutated = applyMutant(source, site)
      if (seen.has(mutated)) return false
      seen.add(mutated)
      try {
        parseScript(mutated)
        return true
      } catch {
        return false
      }
    })
    .map((s, i) => ({ ...s, id: i + 1, ...position(source, s.start) }))
}

const WORD = /[\w$]/
const OPERATOR = /[+\-*/%<>=!&|^~?]/

/** Two characters that would read as one token if nothing separated them. */
function glued(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  return (WORD.test(a) && WORD.test(b)) || (OPERATOR.test(a) && OPERATOR.test(b))
}

/**
 * The source with one mutant applied. A space is added where the new text would otherwise merge
 * with its neighbour: "a+-b" becomes "a- -b", not "a--b"; removing "!" in "typeof!x" gives
 * "typeof x", not "typeofx".
 */
export function applyMutant(source: string, m: Pick<Mutant, "start" | "end" | "replacement">): string {
  const before = source[m.start - 1]
  const after = source[m.end]
  let text = m.replacement
  if (text === "") {
    if (glued(before, after)) text = " "
  } else {
    if (glued(before, text[0])) text = ` ${text}`
    if (glued(text[text.length - 1], after)) text = `${text} `
  }
  return source.slice(0, m.start) + text + source.slice(m.end)
}

/** "a" + b, `${a}`, and anything built on them with + make text; subtraction would mean nothing. */
function isText(n: AnyNode): boolean {
  if (n.type === "TemplateLiteral") return true
  if (n.type === "Literal") return typeof n.value === "string"
  if (n.type === "BinaryExpression" && n.operator === "+") return isText(n.left) || isText(n.right)
  return false
}

function sitesFor(node: AnyNode, source: string): Site[] {
  switch (node.type) {
    case "BinaryExpression": {
      const op = node.operator
      const at = operatorStart(source, node.left.end, node.right.start, op)
      if (at < 0) return []
      const swap = (operator: OperatorId, table: Record<string, string>): Site[] => {
        const to = lookup(table, op)
        return to ? [{ operator, start: at, end: at + op.length, original: op, replacement: to }] : []
      }
      if (op === "+" && (isText(node.left) || isText(node.right))) return []
      return [...swap("boundary", BOUNDARY), ...swap("negate", NEGATE), ...swap("math", MATH)]
    }
    case "LogicalExpression": {
      const op = node.operator
      const to = lookup(LOGIC, op)
      const at = operatorStart(source, node.left.end, node.right.start, op)
      return to && at >= 0 ? [{ operator: "logic", start: at, end: at + op.length, original: op, replacement: to }] : []
    }
    case "IfStatement":
    case "ConditionalExpression": {
      const test = node.test
      if (test.type === "Literal") return []
      const original = source.slice(test.start, test.end)
      return ["true", "false"].map((replacement) => ({
        operator: "condition" as const,
        start: test.start,
        end: test.end,
        original,
        replacement,
      }))
    }
    case "Literal": {
      if (typeof node.value === "boolean") {
        const replacement = node.value ? "false" : "true"
        return [{ operator: "bool", start: node.start, end: node.end, original: String(node.value), replacement }]
      }
      if (typeof node.value === "number" && node.raw && /^\d+(\.\d+)?$/.test(node.raw)) {
        return [{ operator: "constant", start: node.start, end: node.end, original: node.raw, replacement: nudge(node.raw) }]
      }
      return []
    }
    case "MemberExpression": {
      if (node.computed || node.property.type !== "Identifier") return []
      const name = node.property.name
      const { start, end } = node.property
      const onMath = node.object.type === "Identifier" && node.object.name === "Math"
      const minmax = onMath ? lookup(MINMAX, name) : undefined
      const rounding = onMath ? lookup(ROUNDING, name) : undefined
      const someEvery = lookup(SOME_EVERY, name)
      if (minmax) return [{ operator: "minmax", start, end, original: name, replacement: minmax }]
      if (rounding) {
        return rounding.map((to) => ({ operator: "rounding" as const, start, end, original: name, replacement: to }))
      }
      if (someEvery) return [{ operator: "someEvery", start, end, original: name, replacement: someEvery }]
      return []
    }
    case "UnaryExpression": {
      // -15 is a number; the constant operator already nudges it.
      if (node.operator === "-" && node.argument.type === "Literal") return []
      if (node.operator !== "!" && node.operator !== "-") return []
      return [{ operator: "unary", start: node.start, end: node.start + 1, original: node.operator, replacement: "" }]
    }
    default:
      return []
  }
}

/**
 * Where the operator token starts between two operands. Brackets, white space (any kind) and
 * comments may sit between them; anything else means the source is not what we think it is, so
 * we skip the site.
 */
function operatorStart(source: string, from: number, to: number, op: string): number {
  let i = from
  while (i < to) {
    const ch = source[i] ?? ""
    if (ch === ")" || /\s/.test(ch)) {
      i += 1
    } else if (source.startsWith("/*", i)) {
      const close = source.indexOf("*/", i + 2)
      i = close < 0 ? to : close + 2
    } else if (source.startsWith("//", i)) {
      const close = source.indexOf("\n", i)
      i = close < 0 ? to : close + 1
    } else {
      return source.startsWith(op, i) ? i : -1
    }
  }
  return -1
}

/** The smallest step up in the literal's last digit: 15 -> 16, 0.1 -> 0.2, 1.15 -> 1.16. */
export function nudge(raw: string): string {
  const decimals = raw.includes(".") ? raw.length - raw.indexOf(".") - 1 : 0
  const value = Number(raw) + 10 ** -decimals
  return value.toFixed(decimals)
}

function position(source: string, offset: number): { line: number; column: number } {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < offset; i += 1) {
    if (source[i] === "\n") {
      line += 1
      lineStart = i + 1
    }
  }
  return { line, column: offset - lineStart }
}
