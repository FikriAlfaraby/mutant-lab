import { App } from "./ui/app.ts"

const root = document.getElementById("mutant-lab")
if (root) new App(root, root.dataset.worker ?? "mutant-lab-worker.js")
