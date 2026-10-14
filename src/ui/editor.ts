import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { javascript } from "@codemirror/lang-javascript"
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language"
import { EditorState, StateEffect, StateField, Transaction } from "@codemirror/state"
import { Decoration, drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view"
import { tags as t } from "@lezer/highlight"
import type { Range } from "@codemirror/state"
import type { DecorationSet } from "@codemirror/view"

/** A stretch of code to underline, with the words shown on hover. */
export interface Mark {
  from: number
  to: number
  title: string
}

const setMarks = StateEffect.define<Mark[]>()
const setFlash = StateEffect.define<number | null>()

const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setMarks)) {
        const ranges: Range<Decoration>[] = effect.value
          .filter((m) => m.to > m.from)
          .map((m) => Decoration.mark({ class: "ml-mark", attributes: { title: m.title } }).range(m.from, m.to))
        return Decoration.set(ranges, true)
      }
    }
    // Results describe the code they ran on; once the code changes they no longer apply.
    return tr.docChanged ? Decoration.none : value
  },
  provide: (field) => EditorView.decorations.from(field),
})

const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFlash)) {
        if (effect.value === null) return Decoration.none
        const line = tr.state.doc.lineAt(effect.value)
        return Decoration.set([Decoration.line({ class: "ml-flash" }).range(line.from)])
      }
    }
    return tr.docChanged ? Decoration.none : value
  },
  provide: (field) => EditorView.decorations.from(field),
})

const theme = EditorView.theme({
  "&": { color: "var(--ml-ink)", backgroundColor: "transparent", fontSize: "13.5px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace', lineHeight: "1.65" },
  ".cm-content": { padding: "12px 0", caretColor: "var(--ml-ink)" },
  ".cm-line": { padding: "0 16px 0 6px" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--ml-faint)", border: "none", paddingLeft: "6px" },
  ".cm-activeLine": { backgroundColor: "var(--ml-active-line)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--ml-ink)" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--ml-ink)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "var(--ml-selection)",
  },
  ".cm-matchingBracket": { backgroundColor: "var(--ml-selection)", outline: "none" },
})

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword], color: "var(--ml-kw)", fontWeight: "600" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--ml-str)" },
  { tag: [t.number, t.bool, t.null], color: "var(--ml-num)" },
  { tag: [t.lineComment, t.blockComment], color: "var(--ml-comment)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.definition(t.variableName)), t.function(t.propertyName)], color: "var(--ml-fn)" },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: "var(--ml-punct)" },
])

export class CodeEditor {
  readonly view: EditorView
  private flashTimer = 0
  private silent = false

  constructor(parent: HTMLElement, doc: string, label: string, onChange: () => void, onSubmit: () => void) {
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          javascript(),
          syntaxHighlighting(highlight),
          keymap.of([
            { key: "Mod-Enter", run: () => (onSubmit(), true) },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          EditorState.tabSize.of(2),
          EditorView.contentAttributes.of({ "aria-label": label }),
          theme,
          marksField,
          flashField,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !this.silent) onChange()
          }),
        ],
      }),
    })
  }

  get text(): string {
    return this.view.state.doc.toString()
  }

  /** Replace the whole text without counting it as a user edit. */
  load(text: string): void {
    this.silent = true
    // Not in the undo history: Ctrl+Z after switching examples must not bring back the old one.
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
      selection: { anchor: 0 },
      annotations: Transaction.addToHistory.of(false),
    })
    this.silent = false
  }

  /**
   * Append text at the end. Only the editor's own scroller moves to show it: the page stays where
   * the reader is, next to the results that are about to change.
   */
  append(text: string): void {
    const end = this.view.state.doc.length
    const insert = (this.text.endsWith("\n") ? "\n" : "\n\n") + text
    this.silent = true
    this.view.dispatch({ changes: { from: end, insert } })
    this.silent = false
    this.view.requestMeasure({
      read: () => this.view.scrollDOM.scrollHeight,
      write: (height) => {
        this.view.scrollDOM.scrollTop = height
      },
    })
  }

  mark(marks: Mark[]): void {
    this.view.dispatch({ effects: setMarks.of(marks) })
  }

  /** Scroll to a position, put the cursor there and flash its line. */
  reveal(pos: number): void {
    window.clearTimeout(this.flashTimer)
    this.view.dispatch({
      selection: { anchor: pos },
      effects: [EditorView.scrollIntoView(pos, { y: "center" }), setFlash.of(pos)],
    })
    this.view.dom.scrollIntoView({ block: "nearest", behavior: "smooth" })
    this.flashTimer = window.setTimeout(() => this.view.dispatch({ effects: setFlash.of(null) }), 1600)
  }
}
