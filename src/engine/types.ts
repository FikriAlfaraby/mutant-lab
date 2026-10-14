/** The kinds of small change the lab makes. Each mirrors an operator in oracle-mutants. */
export type OperatorId =
  | "boundary"
  | "negate"
  | "math"
  | "logic"
  | "condition"
  | "constant"
  | "bool"
  | "minmax"
  | "rounding"
  | "someEvery"
  | "unary"

/** One small change to the source: replace `original` at [start, end) with `replacement`. */
export interface Mutant {
  id: number
  operator: OperatorId
  start: number
  end: number
  original: string
  replacement: string
  /** 1-based line and 0-based column of `start`. */
  line: number
  column: number
}

export interface TestResult {
  name: string
  passed: boolean
  message?: string
}

/** What one run of the test file produced. `setupError` means the tests never got to run. */
export interface SuiteResult {
  setupError?: string
  tests: TestResult[]
}

/** A run that did not answer within the time limit, usually an endless loop. */
export const TIMED_OUT = "timed-out"
export type RunOutcome = SuiteResult | typeof TIMED_OUT

export type Verdict =
  | { status: "missed" }
  | { status: "caught"; by: "test"; test: string; message: string }
  | { status: "caught"; by: "crash"; message: string }
  | { status: "caught"; by: "timeout" }

export interface MutantResult {
  mutant: Mutant
  verdict: Verdict
}
