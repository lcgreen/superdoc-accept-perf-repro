// Headless benchmark: production build served by `vite preview`, Chromium via Playwright.
// For each document: wait for load, 1 warm-up accept, then N timed accepts
// (ui.trackChanges.accept(id) -> two animation frames). Writes a CPU profile per
// document to results/ (open in Chrome DevTools > Performance > Load profile).
//   npm run build && npm run bench
//   npm run bench -- --throttle 4      (simulate a slower laptop via CDP CPU throttling)
import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { chromium } from "playwright"

const args = process.argv.slice(2)
const throttle = Number(args[args.indexOf("--throttle") + 1]) || 1
const ACCEPTS = 5
const DOCS = ["lease-25", "lease-100", "lease-300"]
const BASE = "http://localhost:4173"

const server = spawn("npx", ["vite", "preview", "--port", "4173", "--strictPort"], { stdio: "ignore" })
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

try {
  for (let i = 0; i < 50; i++) { try { await fetch(BASE); break } catch { await new Promise((r) => setTimeout(r, 200)) } }
  await mkdir("results", { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const rows = []
  for (const doc of DOCS) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
    const t0 = Date.now()
    await page.goto(`${BASE}/?doc=${doc}`)
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 300_000 })
    await page.waitForTimeout(2000)
    const loadS = ((Date.now() - t0) / 1000).toFixed(1)
    const remaining = await page.evaluate(() => window.ui.trackChanges.getSnapshot().items.length)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle })
    await page.evaluate(() => window.acceptNext()) // warm-up
    await cdp.send("Profiler.enable")
    await cdp.send("Profiler.start")
    const times = []
    for (let i = 0; i < ACCEPTS; i++) {
      times.push(await page.evaluate(() => window.acceptNext()))
      await page.waitForTimeout(300)
    }
    const { profile } = await cdp.send("Profiler.stop")
    await writeFile(`results/${doc}-x${throttle}.cpuprofile`, JSON.stringify(profile))
    rows.push({ doc, trackedChanges: remaining, loadS, medianMs: median(times), timesMs: times.join(", ") })
    console.log(`${doc}: ${remaining} tracked changes, loaded ${loadS}s, accept→paint median ${median(times)} ms [${times.join(", ")}]`)
    await page.close()
  }
  await browser.close()
  const md = [`CPU throttle: ${throttle}x`, "", "| Document | Tracked changes | accept() → next paint, median (ms) | Individual runs (ms) |", "|---|---|---|---|",
    ...rows.map((r) => `| ${r.doc} | ${r.trackedChanges} | ${r.medianMs} | ${r.timesMs} |`)].join("\n")
  await writeFile(`results/summary-x${throttle}.md`, md + "\n")
  console.log("\n" + md)
} finally {
  server.kill()
}
