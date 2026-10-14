/** The examples on the page. Their documented survivors are pinned by test/examples.test.ts. */

export interface Fix {
  /** Button label. */
  label: string
  /** Test code appended to the tests when the button is pressed. */
  code: string
}

/** Extra words for one specific mutant, matched by what changed and on which line. */
export interface MutantNote {
  lineIncludes: string
  original: string
  replacement: string
  text: string
  /** Replaces the operator's generic "Catch it" hint. */
  hint?: string
  link?: { href: string; label: string }
}

export interface Example {
  id: string
  tab: string
  blurb: string
  code: string
  tests: string
  fixes: Fix[]
  notes: MutantNote[]
}

const sessions: Example = {
  id: "sessions",
  tab: "Session merger",
  blurb:
    "A stream processor groups events into sessions. This is a small copy of a Terminal-Bench task. " +
    "Its tests check how many sessions there are and what they add up to, but never where a session starts or ends.",
  code: `const GAP = 15 // a pause longer than this ends a session

// Group a stream of events into sessions. Events can arrive late, so one
// event may land between two sessions and merge them into one.
function addEvent(sessions, e) {
  const near = sessions.filter((s) => e.time >= s.start - GAP && e.time <= s.end + GAP)
  if (near.length === 0) {
    return [...sessions, { start: e.time, end: e.time, total: e.value, count: 1 }]
  }
  if (near.length === 1) {
    const s = near[0]
    const grown = {
      start: Math.min(s.start, e.time),
      end: Math.max(s.end, e.time),
      total: s.total + e.value,
      count: s.count + 1,
    }
    return sessions.map((x) => (x === s ? grown : x))
  }
  const [a, b] = near
  return [...sessions.filter((x) => x !== a && x !== b), merge(a, b, e)]
}

function merge(a, b, bridge) {
  return {
    start: Math.min(a.start, b.start, bridge.time),
    end: Math.max(a.end, b.end, bridge.time),
    total: a.total + b.total + bridge.value,
    count: a.count + b.count + 1,
  }
}
`,
  tests: `const run = (events) => events.reduce(addEvent, [])
const at = (time, value = 10) => ({ time, value })

// Two bursts of events, then a late event at 22 that lands between them.
const BURSTS = [at(5), at(8), at(35, 20), at(38, 20)]
const BRIDGED = [...BURSTS, at(22, 5)]

test("events close together form one session", () => {
  expect(run([at(5), at(8)])).toHaveLength(1)
})

test("a long pause starts a new session", () => {
  expect(run(BURSTS)).toHaveLength(2)
})

test("a late event merges two sessions", () => {
  expect(run(BRIDGED)).toHaveLength(1)
})

test("the merged session keeps every event", () => {
  const [s] = run(BRIDGED)
  expect(s.count).toBe(5)
  expect(s.total).toBe(65)
})
`,
  fixes: [
    {
      label: "Add the test I proposed upstream",
      code: `// The test I proposed upstream: a merged session spans both sessions.
test("a merged session spans both sessions", () => {
  const [s] = run(BRIDGED)
  expect([s.start, s.end]).toEqual([5, 38])
})
`,
    },
    {
      label: "Add a test at the exact gap",
      code: `// Exactly 15 apart still joins, in either order. 16 apart splits.
test("events exactly 15 apart join, 16 apart split", () => {
  expect(run([at(5), at(20)])).toHaveLength(1)
  expect(run([at(20), at(5)])).toHaveLength(1)
  expect(run([at(5), at(21)])).toHaveLength(2)
})
`,
    },
  ],
  notes: [
    {
      lineIncludes: "a.end, b.end",
      original: "max",
      replacement: "min",
      text:
        "This is the bug I found in Terminal-Bench. The merged session ends at 8 instead of 38, " +
        "and the task's own tests still gave it full marks.",
      hint: "Check where the merged session starts and ends. The first button above adds the test I proposed upstream.",
      link: { href: "https://github.com/harbor-framework/terminal-bench/issues/2243", label: "Read my report" },
    },
  ],
}

const checkout: Example = {
  id: "checkout",
  tab: "Free shipping",
  blurb:
    "Orders of Rp 100.000 or more ship free, and members get 10% off first. " +
    "Three tests, all green. Does any of them try an order of exactly Rp 100.000?",
  code: `// Orders of Rp 100.000 or more ship free. Members get 10% off first.
function checkout(subtotal, isMember) {
  const discount = isMember ? Math.round(subtotal * 0.1) : 0
  const items = subtotal - discount
  const shipping = items >= 100000 ? 0 : 15000
  return { items, shipping, total: items + shipping }
}
`,
  tests: `test("small orders pay shipping", () => {
  expect(checkout(50000, false)).toEqual({ items: 50000, shipping: 15000, total: 65000 })
})

test("big orders ship free", () => {
  expect(checkout(250000, false).shipping).toBe(0)
})

test("members get 10% off", () => {
  expect(checkout(200000, true).items).toBe(180000)
})
`,
  fixes: [
    {
      label: "Add a test at exactly Rp 100.000",
      code: `// Exactly Rp 100.000 ships free; one rupiah less does not.
test("free shipping starts at exactly 100.000", () => {
  expect(checkout(100000, false).shipping).toBe(0)
  expect(checkout(99999, false).shipping).toBe(15000)
})
`,
    },
    {
      label: "Add a rounding test",
      code: `// 10% of 123.457 is 12.345,7 and of 123.453 is 12.345,3: both round to the nearest rupiah.
test("the member discount rounds to the nearest rupiah", () => {
  expect(checkout(123457, true).items).toBe(111111)
  expect(checkout(123453, true).items).toBe(111108)
})
`,
    },
  ],
  notes: [],
}

const rupiah: Example = {
  id: "rupiah",
  tab: "Rupiah parser",
  blurb:
    "Reads rupiah the way Indonesians write it: dots for thousands, a comma for cents, rb and jt for thousands and millions. " +
    "These tests do their job. Every change should be caught.",
  code: `// "Rp 1.500.000,50" -> 1500000.5   "Rp 289,5 rb" -> 289500   "1,15 jt" -> 1150000
function parseRupiah(text) {
  const t = text.toLowerCase().trim()
  const scale = t.endsWith("jt") ? 1000000 : t.endsWith("rb") ? 1000 : 1
  const number = t.replace(/[^0-9,]/g, "").replace(",", ".")
  return Math.round(Number(number) * scale * 100) / 100
}
`,
  tests: `test("full amounts with cents", () => {
  expect(parseRupiah("Rp 1.500.000,50")).toBe(1500000.5)
})

test("plain amounts", () => {
  expect(parseRupiah("Rp 25.000")).toBe(25000)
})

test("thousands written as rb", () => {
  expect(parseRupiah("Rp 289,5 rb")).toBe(289500)
})

test("millions written as jt", () => {
  expect(parseRupiah("2 jt")).toBe(2000000)
})

// In floating point, 4,1 jt in cents is 409999999.99999994 and 8,3 jt is
// 830000000.0000001. Rounding to whole cents must fix both directions.
test("no floating-point dust", () => {
  expect(parseRupiah("Rp 4,1 jt")).toBe(4100000)
  expect(parseRupiah("Rp 8,3 jt")).toBe(8300000)
})
`,
  fixes: [],
  notes: [],
}

const own: Example = {
  id: "own",
  tab: "Your own code",
  blurb:
    "Edit the code and the tests, then break it. Plain functions only, no imports. " +
    "Tests use test() and expect(), like Jest. Hint for this one: try 1900 and 2000.",
  code: `function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}
`,
  tests: `test("2024 is a leap year", () => {
  expect(isLeapYear(2024)).toBe(true)
})

test("2023 is not", () => {
  expect(isLeapYear(2023)).toBe(false)
})
`,
  fixes: [],
  notes: [],
}

export const EXAMPLES: Example[] = [sessions, checkout, rupiah, own]

/** The note written for this mutant, if any. */
export function noteFor(example: Example, lineText: string, original: string, replacement: string): MutantNote | undefined {
  return example.notes.find(
    (n) => n.original === original && n.replacement === replacement && lineText.includes(n.lineIncludes),
  )
}
