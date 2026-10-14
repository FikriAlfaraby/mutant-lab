/** A small, Jest-shaped `expect` for the tests people write in the lab. */

export class AssertionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AssertionError"
  }
}

export function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return String(value)
  if (typeof value === "function") return "[function]"
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => Object.hasOwn(b, k) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

function check(pass: boolean, message: string): void {
  if (!pass) throw new AssertionError(message)
}

export function expect(actual: unknown) {
  const num = (what: string): number => {
    if (typeof actual !== "number") throw new AssertionError(`${what}: expected a number, got ${show(actual)}`)
    return actual
  }
  return {
    toBe(expected: unknown) {
      check(Object.is(actual, expected), `expected ${show(expected)}, got ${show(actual)}`)
    },
    toEqual(expected: unknown) {
      check(deepEqual(actual, expected), `expected ${show(expected)}, got ${show(actual)}`)
    },
    toBeCloseTo(expected: number, digits = 2) {
      const value = num("toBeCloseTo")
      check(Math.abs(value - expected) < 10 ** -digits / 2, `expected about ${expected}, got ${value}`)
    },
    toBeGreaterThan(limit: number) {
      check(num("toBeGreaterThan") > limit, `expected more than ${limit}, got ${show(actual)}`)
    },
    toBeLessThan(limit: number) {
      check(num("toBeLessThan") < limit, `expected less than ${limit}, got ${show(actual)}`)
    },
    toBeTruthy() {
      check(Boolean(actual), `expected a truthy value, got ${show(actual)}`)
    },
    toBeFalsy() {
      check(!actual, `expected a falsy value, got ${show(actual)}`)
    },
    toHaveLength(length: number) {
      const got = (actual as { length?: unknown } | null)?.length
      check(got === length, `expected length ${length}, got ${show(got)}`)
    },
    toContain(item: unknown) {
      const has = typeof actual === "string" ? actual.includes(String(item)) : Array.isArray(actual) && actual.some((x) => deepEqual(x, item))
      check(has, `expected ${show(actual)} to contain ${show(item)}`)
    },
    toThrow() {
      if (typeof actual !== "function") throw new AssertionError("toThrow needs a function: expect(() => ...).toThrow()")
      let threw = false
      try {
        actual()
      } catch {
        threw = true
      }
      check(threw, "expected the function to throw, it returned normally")
    },
  }
}
