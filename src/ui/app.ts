import { findMutants, ParseError } from "../engine/mutate.ts"
import { EXAMPLES, noteFor } from "../examples.ts"
import { analyse, SandboxRunner } from "../runner.ts"
import { CodeEditor } from "./editor.ts"
import { decodeShare, encodeShare, SHARE_PREFIX } from "./share.ts"
import { OPERATORS, TEXT } from "./text.ts"
import type { Mutant, MutantResult } from "../engine/types.ts"
import type { Example } from "../examples.ts"

type Child = Node | string | null | undefined | false

/** A tiny element builder: attributes, then children. `false`/`null` children are skipped. */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]) {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value)
  for (const child of children) if (child !== null && child !== undefined && child !== false) el.append(child)
  return el
}

interface Draft {
  code: string
  tests: string
  /** Indexes of the example's fixes already appended to the tests. */
  applied: Set<number>
}

interface Run {
  code: string
  testCount: number
  results: MutantResult[]
}

const CONTEXT = 16 // characters of the changed line shown on each side of the change

export class App {
  private readonly pool: SandboxRunner[]
  private readonly drafts = new Map<string, Draft>()
  private example: Example
  private runToken = 0
  private running = false
  private changedSinceRun = false
  private lastRun: Run | null = null
  /** Shown once the next run finishes, e.g. that a fix was added to the tests. */
  private afterRun = ""

  private readonly tabs: HTMLButtonElement[]
  private readonly blurb = h("p", { class: "ml-blurb" })
  private readonly runButton = h("button", { class: "btn btn--primary ml-run", type: "button" }, TEXT.run)
  private readonly resetButton = h("button", { class: "btn btn--ghost btn--small", type: "button" }, TEXT.reset)
  private readonly shareButton = h("button", { class: "btn btn--ghost btn--small", type: "button" }, TEXT.copyLink)
  private readonly status = h("p", { class: "ml-status", role: "status", "aria-live": "polite" })
  private readonly results = h("div", { class: "ml-results", hidden: "" })
  private readonly meter = h("ol", { class: "ml-meter", "aria-hidden": "true" })
  private readonly scoreTitle = h("p", { class: "ml-score__title" })
  private readonly scoreSub = h("p", { class: "ml-score__sub" })
  private readonly fixes = h("div", { class: "ml-fixes" })
  private readonly missedList = h("ol", { class: "ml-missed" })
  private readonly falseAlarm = h(
    "p",
    { class: "ml-false-alarm" },
    `${TEXT.falseAlarm} `,
    h("a", { href: TEXT.falseAlarmLink.href }, TEXT.falseAlarmLink.label),
  )
  private readonly caught = h("details", { class: "ml-caught" })
  private readonly caughtSummary = h("summary")
  private readonly caughtList = h("ol")
  private readonly codeEditor: CodeEditor
  private readonly testsEditor: CodeEditor

  constructor(root: HTMLElement, workerUrl: string) {
    // A few workers in parallel: a mutant that loops forever only holds up its own worker.
    const size = Math.min(4, Math.max(2, navigator.hardwareConcurrency || 2))
    this.pool = Array.from({ length: size }, () => new SandboxRunner(workerUrl))
    const first = EXAMPLES[0]
    if (!first) throw new Error("no examples")
    this.example = first

    this.tabs = EXAMPLES.map((ex) =>
      h("button", { class: "ml-tab", type: "button", role: "tab", "aria-selected": "false", "data-example": ex.id }, ex.tab),
    )
    const codeHost = h("div", { class: "ml-pane__editor" })
    const testsHost = h("div", { class: "ml-pane__editor" })
    this.caught.append(this.caughtSummary, this.caughtList)
    this.results.append(
      this.meter,
      h("div", { class: "ml-score" }, this.scoreTitle, this.scoreSub),
      this.fixes,
      this.missedList,
      this.falseAlarm,
      this.caught,
    )

    root.replaceChildren(
      h(
        "div",
        { class: "ml" },
        h("div", { class: "ml-tabs", role: "tablist", "aria-label": TEXT.examplesLabel }, ...this.tabs),
        h(
          "div",
          { class: "ml-body" },
          h(
            "section",
            { class: "ml-panel", "aria-label": "Results" },
            this.blurb,
            h("div", { class: "ml-actions" }, this.runButton, this.resetButton, this.shareButton),
            h("p", { class: "ml-shortcut mono" }, TEXT.shortcut(/Mac|iPhone|iPad/.test(navigator.userAgent))),
            this.status,
            this.results,
          ),
          h(
            "div",
            { class: "ml-editors" },
            pane(TEXT.codeLabel, TEXT.codeNote, codeHost),
            pane(TEXT.testsLabel, TEXT.testsNote, testsHost),
          ),
        ),
      ),
    )

    const run = () => void this.run()
    this.codeEditor = new CodeEditor(codeHost, first.code, "Code under test", () => this.edited(), run)
    this.testsEditor = new CodeEditor(testsHost, first.tests, "Tests", () => this.edited(), run)

    this.runButton.addEventListener("click", run)
    this.resetButton.addEventListener("click", () => this.reset())
    this.shareButton.addEventListener("click", () => void this.share())
    this.tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => this.select(EXAMPLES[i] ?? first))
      tab.addEventListener("keydown", (event) => this.tabKey(event, i))
    })

    this.select(first)
    this.loadShared()
  }

  private get draft(): Draft {
    let draft = this.drafts.get(this.example.id)
    if (!draft) {
      draft = { code: this.example.code, tests: this.example.tests, applied: new Set() }
      this.drafts.set(this.example.id, draft)
    }
    return draft
  }

  private select(example: Example): void {
    this.saveDraft()
    this.cancelRun()
    this.example = example
    for (const tab of this.tabs) {
      const on = tab.dataset.example === example.id
      tab.setAttribute("aria-selected", String(on))
      tab.tabIndex = on ? 0 : -1
    }
    this.blurb.textContent = example.blurb
    this.codeEditor.load(this.draft.code)
    this.testsEditor.load(this.draft.tests)
    this.clearResults()
    this.syncReset()
  }

  private saveDraft(): void {
    if (!this.codeEditor) return
    this.draft.code = this.codeEditor.text
    this.draft.tests = this.testsEditor.text
  }

  private tabKey(event: KeyboardEvent, i: number): void {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next = (i + step + this.tabs.length) % this.tabs.length
    this.tabs[next]?.focus()
    this.tabs[next]?.click()
  }

  private reset(): void {
    this.cancelRun()
    this.drafts.delete(this.example.id)
    this.codeEditor.load(this.example.code)
    this.testsEditor.load(this.example.tests)
    this.clearResults()
    this.syncReset()
  }

  private cancelRun(): void {
    this.runToken += 1
    this.setBusy(false)
  }

  private clearResults(): void {
    this.lastRun = null
    this.changedSinceRun = false
    this.results.hidden = true
    this.results.classList.remove("is-stale")
    this.say("")
    this.runButton.textContent = TEXT.run
    this.codeEditor?.mark([])
  }

  /** Reset is offered only once there is something to undo. */
  private syncReset(): void {
    const draft = this.drafts.get(this.example.id)
    const changed =
      this.codeEditor.text !== this.example.code || this.testsEditor.text !== this.example.tests || (draft?.applied.size ?? 0) > 0
    this.resetButton.hidden = !changed
  }

  private edited(): void {
    this.syncReset()
    this.changedSinceRun = true
    if (this.lastRun && !this.running) this.markStale()
  }

  private markStale(): void {
    this.results.classList.add("is-stale")
    this.say(TEXT.stale)
  }

  private setBusy(busy: boolean): void {
    this.running = busy
    this.runButton.disabled = busy
    this.runButton.setAttribute("aria-busy", String(busy))
  }

  private say(message: string, tone: "plain" | "error" = "plain"): void {
    this.status.textContent = message
    this.status.classList.toggle("is-error", tone === "error")
  }

  private async run(): Promise<void> {
    if (this.running) return
    const code = this.codeEditor.text
    const tests = this.testsEditor.text
    let mutants: Mutant[]
    try {
      mutants = findMutants(code)
    } catch (err) {
      if (!(err instanceof ParseError)) throw err
      this.results.hidden = true
      this.say(TEXT.parseError(err.line, err.message), "error")
      const line = this.codeEditor.view.state.doc.line(Math.min(err.line, this.codeEditor.view.state.doc.lines))
      this.codeEditor.reveal(line.from)
      return
    }
    if (mutants.length === 0) {
      this.results.hidden = true
      this.say(TEXT.nothingToChange)
      return
    }

    const token = ++this.runToken
    this.setBusy(true)
    this.changedSinceRun = false
    this.lastRun = null
    this.codeEditor.mark([])
    this.startResults(mutants.length)

    let analysis: Awaited<ReturnType<typeof analyse>>
    try {
      analysis = await analyse(
        this.pool,
        code,
        tests,
        mutants,
        (result, index, done) => {
          if (token !== this.runToken) return
          const segment = this.meter.children[index]
          segment?.setAttribute("data-state", result.verdict.status)
          this.say(TEXT.progress(done, mutants.length))
        },
        () => token !== this.runToken,
      )
    } catch (err) {
      // Never leave the button disabled: say what happened and give the page back.
      console.error(err)
      if (token !== this.runToken) return
      this.setBusy(false)
      this.results.hidden = true
      this.say(TEXT.sandboxFailed, "error")
      return
    }
    if (token !== this.runToken) return
    this.setBusy(false)
    this.runButton.textContent = TEXT.runAgain

    if (analysis.baseline) {
      this.results.hidden = true
      this.say(TEXT.baseline(analysis.baseline), "error")
      return
    }
    this.lastRun = { code, testCount: analysis.testCount, results: analysis.results }
    this.showResults(this.lastRun)
    if (this.changedSinceRun) this.markStale()
  }

  private startResults(total: number): void {
    this.results.hidden = false
    this.results.classList.remove("is-stale")
    this.results.classList.add("is-running")
    this.meter.replaceChildren(...Array.from({ length: total }, () => h("li", { "data-state": "pending" })))
    this.scoreTitle.textContent = ""
    this.scoreSub.textContent = ""
    this.fixes.replaceChildren()
    this.missedList.replaceChildren()
    this.caughtList.replaceChildren()
    this.falseAlarm.hidden = true
    this.caught.hidden = true
    this.say(TEXT.progress(0, total))
  }

  private showResults(run: Run): void {
    const missed = run.results.filter((r) => r.verdict.status === "missed")
    const caught = run.results.filter((r) => r.verdict.status !== "missed")
    const total = run.results.length
    this.results.classList.remove("is-running")
    this.say(this.afterRun)
    this.afterRun = ""
    this.scoreTitle.textContent = missed.length ? TEXT.scoreSome(caught.length, total) : TEXT.scoreAll(total)
    this.scoreSub.textContent = missed.length ? TEXT.subSome(missed.length, run.testCount) : TEXT.subAll
    this.results.classList.toggle("is-clean", missed.length === 0)

    const open = missed.length ? this.example.fixes.map((fix, i) => ({ fix, i })).filter(({ i }) => !this.draft.applied.has(i)) : []
    this.fixes.replaceChildren(
      ...open.map(({ fix, i }) => {
        const button = h("button", { class: "btn btn--ghost btn--small ml-fix", type: "button" }, fix.label)
        button.addEventListener("click", () => this.applyFix(i))
        return button
      }),
    )

    const lines = run.code.split("\n")
    // A change with its own story (the Terminal-Bench bug) goes first; the rest in code order.
    const noted = (m: Mutant) => (noteFor(this.example, lines[m.line - 1] ?? "", m.original, m.replacement) ? 0 : 1)
    const ordered = [...missed].sort((a, b) => noted(a.mutant) - noted(b.mutant) || a.mutant.start - b.mutant.start)
    this.missedList.replaceChildren(...ordered.map((r) => this.missedCard(r.mutant, lines)))
    this.falseAlarm.hidden = missed.length === 0

    this.caught.hidden = caught.length === 0
    this.caughtSummary.textContent = TEXT.caughtSummary(caught.length)
    this.caughtList.replaceChildren(...caught.map((r) => this.caughtRow(r)))

    this.codeEditor.mark(
      missed.map(({ mutant: m }) => ({
        from: m.start,
        to: m.end,
        title: `${OPERATORS[m.operator].name}: ${m.original} → ${m.replacement || "(removed)"}. ${TEXT.stillPass(run.testCount)}`,
      })),
    )
  }

  private applyFix(index: number): void {
    const fix = this.example.fixes[index]
    if (!fix || this.running) return
    this.draft.applied.add(index)
    this.testsEditor.append(fix.code)
    this.afterRun = TEXT.fixAdded
    this.syncReset()
    void this.run()
  }

  private missedCard(m: Mutant, lines: string[]): HTMLLIElement {
    const lineText = lines[m.line - 1] ?? ""
    const note = noteFor(this.example, lineText, m.original, m.replacement)
    const jump = h("button", { class: "ml-card__line mono", type: "button" }, TEXT.line(m.line))
    jump.addEventListener("click", () => {
      if (!this.changedSinceRun) this.codeEditor.reveal(m.start)
    })
    return h(
      "li",
      { class: note ? "ml-card ml-card--noted" : "ml-card" },
      h("div", { class: "ml-card__head" }, h("span", { class: "ml-chip mono" }, OPERATORS[m.operator].name), jump),
      diff(lineText, m),
      note
        ? h(
            "p",
            { class: "ml-card__text" },
            `${note.text} `,
            note.link ? h("a", { href: note.link.href, rel: "noopener" }, note.link.label) : null,
          )
        : null,
      h("p", { class: "ml-card__hint" }, h("strong", {}, TEXT.catchIt), note?.hint ?? OPERATORS[m.operator].hint),
    )
  }

  private caughtRow({ mutant: m, verdict }: MutantResult): HTMLLIElement {
    const how =
      verdict.status === "missed"
        ? ""
        : verdict.by === "test"
          ? TEXT.caughtBy(verdict.test)
          : verdict.by === "crash"
            ? TEXT.caughtCrash
            : TEXT.caughtTimeout
    return h(
      "li",
      {},
      h("span", { class: "ml-chip ml-chip--quiet mono" }, OPERATORS[m.operator].name),
      h("span", { class: "ml-caught__line mono" }, TEXT.line(m.line)),
      h("code", { class: "ml-caught__change" }, `${short(m.original)} → ${m.replacement || "(removed)"}`),
      h("span", { class: "ml-caught__how" }, how),
    )
  }

  private async share(): Promise<void> {
    const url = `${location.origin}${location.pathname}${SHARE_PREFIX}${encodeShare({
      code: this.codeEditor.text,
      tests: this.testsEditor.text,
    })}`
    try {
      await navigator.clipboard.writeText(url)
      this.shareButton.textContent = TEXT.linkCopied
      window.setTimeout(() => (this.shareButton.textContent = TEXT.copyLink), 2000)
    } catch {
      history.replaceState(null, "", url)
      this.say(TEXT.linkInBar)
    }
  }

  private loadShared(): void {
    if (!location.hash.startsWith(SHARE_PREFIX)) return
    const shared = decodeShare(location.hash.slice(SHARE_PREFIX.length))
    if (!shared) {
      this.say(TEXT.badLink, "error")
      return
    }
    const own = EXAMPLES.find((e) => e.id === "own")
    if (!own) return
    this.select(own)
    this.codeEditor.load(shared.code)
    this.testsEditor.load(shared.tests)
    this.syncReset()
    this.say(TEXT.shared)
  }
}

function pane(title: string, note: string, editor: HTMLElement): HTMLElement {
  return h(
    "section",
    { class: "ml-pane", "aria-label": title },
    h("header", { class: "ml-pane__head" }, h("span", { class: "ml-pane__title" }, title), h("span", { class: "ml-pane__note" }, note)),
    editor,
  )
}

/** Long originals (a whole condition) are shortened so a row stays one line. */
function short(text: string): string {
  const one = text.replace(/\s+/g, " ")
  return one.length > 28 ? `${one.slice(0, 27)}…` : one
}

/** The changed line before and after, trimmed to the neighbourhood of the change. */
function diff(lineText: string, m: Mutant): HTMLElement {
  const original = m.original.split("\n")[0] ?? ""
  const indent = lineText.length - lineText.trimStart().length
  const from = Math.max(indent, m.column - CONTEXT)
  const to = Math.min(lineText.length, m.column + original.length + CONTEXT)
  const before = (from > indent ? "…" : "") + lineText.slice(from, m.column)
  const after = lineText.slice(m.column + original.length, to) + (to < lineText.length ? "…" : "")
  const row = (sign: string, cls: string, changed: HTMLElement) =>
    h("span", { class: `ml-diff__row ${cls}` }, h("span", { class: "ml-diff__sign", "aria-hidden": "true" }, sign), before, changed, after)
  return h(
    "pre",
    { class: "ml-diff mono", "aria-label": `Changed ${m.original} to ${m.replacement || "nothing"}` },
    row("−", "ml-diff__row--old", h("del", {}, original)),
    row("+", "ml-diff__row--new", h("ins", {}, m.replacement)),
  )
}
