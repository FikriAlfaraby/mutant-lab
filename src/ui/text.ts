/** Every word the lab shows, in one place, so the copy can be read and reviewed without the code. */
import type { BaselineProblem } from "../engine/suite.ts"
import type { OperatorId } from "../engine/types.ts"

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

export const TEXT = {
  examplesLabel: "Examples",
  codeLabel: "Code",
  codeNote: "the function under test",
  testsLabel: "Tests",
  testsNote: "test() and expect(), like Jest",
  run: "Break the code",
  runAgain: "Break it again",
  reset: "Reset",
  copyLink: "Share",
  linkCopied: "Link copied",
  linkInBar: "The link is in the address bar",

  progress: (done: number, total: number) => `Testing change ${done} of ${total}…`,
  scoreAll: (total: number) => (total === 1 ? "Your tests caught the only change." : `Your tests caught all ${total} changes.`),
  scoreSome: (caught: number, total: number) => `Your tests caught ${caught} of ${total} changes.`,
  subAll: "Nothing slipped through.",
  subSome: (missed: number, tests: number) =>
    `${missed} ${plural(missed, "change slipped", "changes slipped")} through: ` +
    `${tests === 1 ? "the test still passes" : tests === 2 ? "both tests still pass" : `all ${tests} tests still pass`} ` +
    `with ${plural(missed, "it", "each one")}.`,
  stillPass: (tests: number) => (tests === 1 ? "The test still passes." : `All ${tests} tests still pass.`),
  catchIt: "Catch it: ",
  line: (n: number) => `line ${n}`,
  caughtSummary: (n: number) => `Caught changes (${n})`,
  caughtBy: (test: string) => `caught by “${test}”`,
  caughtCrash: "caught: the code crashed",
  caughtTimeout: "caught: it never finished",
  falseAlarm: "Not every miss is a bug. Some changes can't alter what the code does. Read each one and ask: would this matter?",
  falseAlarmLink: { href: "/notes/false-alarms/", label: "Five kinds of survivor that are not bugs" },

  stale: "You changed the code. Break it again to update the results.",
  fixAdded: "Test added at the end of the tests.",
  sandboxFailed: "The lab could not start its test sandbox in this browser. Reload the page and try again.",
  shared: "Loaded from a shared link. Read the code, then break it.",
  badLink: "This link is damaged, so the examples are shown instead.",
  shortcut: (mac: boolean) => `or press ${mac ? "⌘" : "Ctrl"} Enter in an editor`,
  nothingToChange: "Nothing here to change. The lab changes comparisons, maths, branches, numbers and true/false values.",
  parseError: (line: number, message: string) => `Line ${line}: ${message}. Fix the code, then try again.`,
  noModules: (line: number) => `Line ${line}: import and export can't run here. Write plain functions, then try again.`,
  baseline(problem: BaselineProblem): string {
    switch (problem.kind) {
      case "no-tests":
        return 'No tests found. Write each one as test("name", () => { … }).'
      case "timeout":
        return "Your tests never finished on the original code. Look for an endless loop."
      case "crash":
        return `The code or the tests crash before any test runs: ${problem.detail}`
      case "failing":
        return `Your tests fail on the original code, so no change can be judged yet. First failure, “${problem.test}”: ${problem.detail}`
    }
  },
}

/** What each kind of change is called on the page, and what test would catch it. */
export const OPERATORS: Record<OperatorId, { name: string; hint: string }> = {
  boundary: { name: "Boundary", hint: "Add a test with a value exactly on the boundary." },
  negate: { name: "Comparison", hint: "Add a test where this comparison comes out the other way." },
  math: { name: "Maths", hint: "Check the exact result of this calculation." },
  logic: { name: "And/or", hint: "Add a test where only one side of this condition is true." },
  condition: { name: "Branch", hint: "Add a test that takes the other branch." },
  constant: { name: "Number", hint: "Add a test that depends on this exact number." },
  bool: { name: "True/false", hint: "Add a test where this flag changes the result." },
  minmax: { name: "Min/max", hint: "Add a test where the smaller and the larger value differ, and check which one is kept." },
  rounding: { name: "Rounding", hint: "Add a test with a fraction that rounds the other way." },
  someEvery: { name: "Some/every", hint: "Add a test where some items match and others don't." },
  unary: { name: "Not", hint: "Add a test where the opposite case matters." },
}
