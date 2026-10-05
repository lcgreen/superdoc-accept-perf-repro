import "@harbour-enterprises/superdoc/style.css"
import { SuperDoc } from "@harbour-enterprises/superdoc"
import { createSuperDocUI } from "@harbour-enterprises/superdoc/ui"

const docName = new URLSearchParams(location.search).get("doc") || "lease-100"
const status = document.getElementById("status")
const log = document.getElementById("log")
const buttons = [document.getElementById("accept"), document.getElementById("accept5")]

const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

async function main() {
  const t0 = performance.now()
  const bytes = await (await fetch(`/${docName}.docx`)).arrayBuffer()
  const file = new File([bytes], `${docName}.docx`, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  })

  // Configuration mirrors a typical review integration: editing mode, comments
  // + tracked changes surfaced via onCommentsUpdate and the superdoc/ui controller.
  const superdoc = new SuperDoc({
    selector: "#editor",
    document: file,
    user: { name: "Reviewer", email: "reviewer@example.com" },
    role: "editor",
    documentMode: "editing",
    annotations: true,
    rulers: false,
    telemetry: { enabled: false },
    onCommentsUpdate: () => {},
    onReady: () => ready(superdoc, t0),
  })
  window.superdoc = superdoc
}

function ready(superdoc, t0) {
  const ui = createSuperDocUI({ superdoc })
  window.ui = ui
  // A review sidebar would subscribe to the tracked-changes feed like this.
  let items = []
  ui.trackChanges.subscribe(({ snapshot }) => {
    items = snapshot?.items ?? []
    status.textContent = `${docName}: loaded in ${Math.round(performance.now() - t0)} ms — ${items.length} tracked changes remaining`
  })

  let n = 0
  async function acceptNext() {
    const id = items[0]?.id
    if (!id) return null
    const start = performance.now()
    ui.trackChanges.accept(id)
    await nextPaint()
    const ms = Math.round(performance.now() - start)
    const row = document.createElement("tr")
    row.innerHTML = `<td>${++n}</td><td>${ms}</td>`
    log.prepend(row)
    return ms
  }
  window.acceptNext = acceptNext

  buttons[0].onclick = () => acceptNext()
  buttons[1].onclick = async () => { for (let i = 0; i < 5; i++) await acceptNext() }
  buttons.forEach((b) => (b.disabled = false))
  window.__ready = true
}

main().catch((e) => { status.textContent = `Failed: ${e}`; console.error(e) })
