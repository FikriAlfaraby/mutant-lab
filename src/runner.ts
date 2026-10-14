import { applyMutant } from "./engine/mutate.ts"
import { baselineProblem, judge } from "./engine/suite.ts"
import { TIMED_OUT } from "./engine/types.ts"
import type { BaselineProblem } from "./engine/suite.ts"
import type { Mutant, MutantResult, RunOutcome } from "./engine/types.ts"
import type { Job, Reply } from "./worker.ts"

/** The original code gets this long, worker start-up included. */
const BASELINE_TIMEOUT_MS = 4000
/** A mutant gets ten times what the original took, and never less than this. */
const MIN_MUTANT_TIMEOUT_MS = 400

/** Runs suites in one Web Worker. A run that takes too long kills the worker and counts as a timeout. */
export class SandboxRunner {
  private readonly url: string
  private worker: Worker | null = null
  private nextId = 0
  private queue: Promise<unknown> = Promise.resolve()

  constructor(url: string) {
    this.url = url
  }

  /** Runs are queued: one worker answers one job at a time, so a reply can never cross runs. */
  run(code: string, tests: string, timeoutMs: number): Promise<RunOutcome> {
    const next = this.queue.then(() => this.exec(code, tests, timeoutMs))
    this.queue = next
    return next
  }

  private exec(code: string, tests: string, timeoutMs: number): Promise<RunOutcome> {
    const worker = (this.worker ??= new Worker(this.url))
    const id = ++this.nextId
    return new Promise((resolve) => {
      const finish = (outcome: RunOutcome, restart: boolean) => {
        clearTimeout(timer)
        worker.onmessage = null
        worker.onerror = null
        if (restart) this.stop()
        resolve(outcome)
      }
      const timer = setTimeout(() => finish(TIMED_OUT, true), timeoutMs)
      worker.onmessage = (event: MessageEvent<Reply>) => {
        // The code under test can post messages too; only our reply settles the run.
        if (event.data?.id === id && event.data.result) finish(event.data.result, false)
      }
      worker.onerror = (event) => {
        event.preventDefault()
        finish({ setupError: event.message || "the code crashed the sandbox", tests: [] }, true)
      }
      worker.postMessage({ id, code, tests } satisfies Job)
    })
  }

  stop(): void {
    this.worker?.terminate()
    this.worker = null
  }
}

export interface Analysis {
  baseline: BaselineProblem | null
  /** How many tests the original code passed. */
  testCount: number
  results: MutantResult[]
}

/**
 * Checks the original code first, then every mutant, spread over the pool's workers. `onResult`
 * fires as each verdict arrives (with how many are done) so the page can fill in during the run.
 * `cancelled` is polled between runs. Results come back in mutant order.
 */
export async function analyse(
  pool: SandboxRunner[],
  code: string,
  tests: string,
  mutants: Mutant[],
  onResult: (result: MutantResult, index: number, done: number) => void,
  cancelled: () => boolean,
): Promise<Analysis> {
  const [first] = pool
  if (!first) throw new Error("analyse needs at least one runner")
  const started = performance.now()
  const original = await first.run(code, tests, BASELINE_TIMEOUT_MS)
  const baseline = baselineProblem(original)
  if (baseline || original === TIMED_OUT) return { baseline, testCount: 0, results: [] }

  const limit = Math.max(MIN_MUTANT_TIMEOUT_MS, Math.round((performance.now() - started) * 10))
  const results: (MutantResult | undefined)[] = new Array(mutants.length)
  let next = 0
  let done = 0
  await Promise.all(
    pool.map(async (runner) => {
      for (let index = next++; index < mutants.length && !cancelled(); index = next++) {
        const mutant = mutants[index]
        if (!mutant) continue
        const result = { mutant, verdict: judge(await runner.run(applyMutant(code, mutant), tests, limit)) }
        results[index] = result
        done += 1
        onResult(result, index, done)
      }
    }),
  )
  return { baseline: null, testCount: original.tests.length, results: results.filter((r) => r !== undefined) }
}
