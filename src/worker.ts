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

// The code under test is the visitor's own, or code from a link they chose to run. It needs no
// network, so take the network away before it runs: fetch, XHR, sockets, imports, nested workers.
// Each property is removed from the worker's global object and from the prototypes it inherits.
const NETWORK = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "Worker", "SharedWorker", "BroadcastChannel", "WebTransport"]
for (let target: object | null = globalThis; target; target = Object.getPrototypeOf(target)) {
  for (const name of NETWORK) {
    if (Object.hasOwn(target, name)) {
      try {
        Object.defineProperty(target, name, { value: undefined, configurable: false, writable: false })
      } catch {
        // A property the engine refuses to redefine stays as it is; the next one still goes.
      }
    }
  }
}

scope.onmessage = ({ data }) => {
  scope.postMessage({ id: data.id, result: runSuite(data.code, data.tests) })
}
