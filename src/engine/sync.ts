import { applyMutant } from "./mutate.ts"
import { judge, runSuite } from "./suite.ts"
import type { Mutant, MutantResult } from "./types.ts"

/** Every mutant judged in this thread, one after another. For code that cannot loop forever. */
export function analyseSync(code: string, tests: string, mutants: Mutant[]): MutantResult[] {
  return mutants.map((mutant) => ({ mutant, verdict: judge(runSuite(applyMutant(code, mutant), tests)) }))
}
