// Runs one test suite per message, away from the page, so a mutant that loops forever can be
// stopped by terminating this worker without freezing the tab.
import { runSuite } from "./engine/suite.ts"
import type { SuiteResult } from "./engine/types.ts"

export interface Job {
  id: number
  code: string
  tests: string
}

export interface Reply {
  id: number
  result: SuiteResult
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<Job>) => void) | null
  postMessage(message: Reply): void
}

const scope = globalThis as unknown as WorkerScope

scope.onmessage = ({ data }) => {
  scope.postMessage({ id: data.id, result: runSuite(data.code, data.tests) })
}
