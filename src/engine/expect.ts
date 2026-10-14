/** A small, Jest-shaped `expect` for the tests people write in the lab. */

export class AssertionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AssertionError"
  }
}

const tag = (value: unknown) => Object.prototype.toString.call(value)

export function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return String(value)
  if (typeof value === "function") return "[function]"
  if (value instanceof Set) return `Set ${show([...value])}`
  if (value instanceof Map) return `Map ${show([...value])}`
  if (value instanceof Date) return `Date(${value.toISOString()})`
  if (value instanceof RegExp || value instanceof Error) return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * Structural equality, the way toEqual reads it. Sets, Maps, Dates, RegExps and Errors are
 * compared by what they hold; values of different kinds are never equal.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (tag(a) !== tag(b)) return false
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (a instanceof RegExp && b instanceof RegExp) return String(a) === String(b)
  if (a instanceof Error && b instanceof Error) return a.name === b.name && a.message === b.message
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false
    const rest = [...b]
    return [...a].every((x) => {
      const i = rest.findIndex((y) => deepEqual(x, y))
      if (i < 0) return false
      rest.splice(i, 1)
      return true
    })
  }
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false
    return [...a].every(([k, v]) => b.has(k) && deepEqual(v, b.get(k)))
  }
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => Object.hasOwn(b, k) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

function threw(fn: unknown): { threw: boolean; error?: unknown } {
  if (typeof fn !== "function") throw new AssertionError("toThrow needs a function: expect(() => ...).toThrow()")
  try {
    fn()
    return { threw: false }
  } catch (error) {
    return { threw: true, error }
  }
}

function messageMatches(error: unknown, expected: unknown): boolean {
  if (expected === undefined) return true
  const message = error instanceof Error ? error.message : String(error)
  if (typeof expected === "string") return message.includes(expected)
  if (expected instanceof RegExp) return expected.test(message)
  throw new AssertionError("toThrow accepts a message string or a regular expression")
}

export interface Checks {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
  toStrictEqual(expected: unknown): void
  toBeCloseTo(expected: number, digits?: number): void
  toBeGreaterThan(limit: number): void
  toBeGreaterThanOrEqual(limit: number): void
  toBeLessThan(limit: number): void
  toBeLessThanOrEqual(limit: number): void
  toBeTruthy(): void
  toBeFalsy(): void
  toBeNull(): void
  toBeUndefined(): void
  toBeDefined(): void
  toHaveLength(length: number): void
  toContain(item: unknown): void
  toMatch(pattern: RegExp | string): void
  toThrow(expected?: unknown): void
}

export type Expectation = Checks & { not: Checks }

function matchers(actual: unknown, negated: boolean): Checks {
  // Each check states what must hold; `negated` flips it and the message says "not".
  const check = (pass: boolean, message: string) => {
    if (pass === negated) throw new AssertionError(negated ? `expected not: ${message}` : message)
  }
  const num = (what: string): number => {
    if (typeof actual !== "number") throw new AssertionError(`${what}: expected a number, got ${show(actual)}`)
    return actual
  }
  return {
    toBe: (expected: unknown) => check(Object.is(actual, expected), `expected ${show(expected)}, got ${show(actual)}`),
    toEqual: (expected: unknown) => check(deepEqual(actual, expected), `expected ${show(expected)}, got ${show(actual)}`),
    toStrictEqual: (expected: unknown) => check(deepEqual(actual, expected), `expected ${show(expected)}, got ${show(actual)}`),
    toBeCloseTo: (expected: number, digits = 2) => {
      const value = num("toBeCloseTo")
      check(Math.abs(value - expected) < 10 ** -digits / 2, `expected about ${expected}, got ${value}`)
    },
    toBeGreaterThan: (limit: number) => check(num("toBeGreaterThan") > limit, `expected more than ${limit}, got ${show(actual)}`),
    toBeGreaterThanOrEqual: (limit: number) =>
      check(num("toBeGreaterThanOrEqual") >= limit, `expected at least ${limit}, got ${show(actual)}`),
    toBeLessThan: (limit: number) => check(num("toBeLessThan") < limit, `expected less than ${limit}, got ${show(actual)}`),
    toBeLessThanOrEqual: (limit: number) =>
      check(num("toBeLessThanOrEqual") <= limit, `expected at most ${limit}, got ${show(actual)}`),
    toBeTruthy: () => check(Boolean(actual), `expected a truthy value, got ${show(actual)}`),
    toBeFalsy: () => check(!actual, `expected a falsy value, got ${show(actual)}`),
    toBeNull: () => check(actual === null, `expected null, got ${show(actual)}`),
    toBeUndefined: () => check(actual === undefined, `expected undefined, got ${show(actual)}`),
    toBeDefined: () => check(actual !== undefined, "expected a defined value, got undefined"),
    toHaveLength: (length: number) => {
      const got = (actual as { length?: unknown } | null)?.length
      check(got === length, `expected length ${length}, got ${show(got)}`)
    },
    toContain: (item: unknown) => {
      const has =
        typeof actual === "string"
          ? actual.includes(String(item))
          : Array.isArray(actual) || actual instanceof Set
            ? [...actual].some((x) => deepEqual(x, item))
            : false
      check(has, `expected ${show(actual)} to contain ${show(item)}`)
    },
    toMatch: (pattern: RegExp | string) => {
      if (typeof actual !== "string") throw new AssertionError(`toMatch: expected a string, got ${show(actual)}`)
      check(typeof pattern === "string" ? actual.includes(pattern) : pattern.test(actual), `expected ${show(actual)} to match ${String(pattern)}`)
    },
    toThrow: (expected?: unknown) => {
      const result = threw(actual)
      const ok = result.threw && messageMatches(result.error, expected)
      check(ok, result.threw ? `expected an error matching ${show(expected)}, got ${show(result.error)}` : "expected the function to throw, it returned normally")
    },
  }
}

// Keys that tooling reads on any object (awaiting, printing); asking for them is not a matcher call.
const PASSIVE = new Set(["then", "toJSON", "constructor", "valueOf", "toString", "asymmetricMatch", "$$typeof", "nodeType"])

/** Any matcher this expect does not know says so, instead of failing as a TypeError. */
function guarded<T extends object>(table: T): T {
  return new Proxy(table, {
    get(target, key) {
      if (typeof key === "symbol" || Object.hasOwn(target, key) || PASSIVE.has(key)) return Reflect.get(target, key)
      const known = Object.keys(target).filter((k) => k !== "not")
      throw new AssertionError(`expect(...).${key} is not supported here. Use ${known.join(", ")}, or .not before any of them`)
    },
  })
}

export function expect(actual: unknown): Expectation {
  return guarded({ ...matchers(actual, false), not: guarded(matchers(actual, true)) })
}
