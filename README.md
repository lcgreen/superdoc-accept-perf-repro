# SuperDoc: accepting a tracked change gets quadratically slower on large documents

Minimal, standalone reproduction for `@harbour-enterprises/superdoc` **1.47.0** (latest v1).

Accepting a single tracked change takes time proportional to
**(number of tracked changes) × (document size)**. On a long document with many
tracked changes, such as a 100–300 page legal document returned with hundreds
of redlines, each accept/reject click blocks the main thread for seconds.

## Results

Synthetic documents (numbered clauses, every third paragraph a tracked
replacement, i.e. a `w:del` + `w:ins` pair). Timing is from
`ui.trackChanges.accept(id)` to the next painted frame (two `requestAnimationFrame`s),
median of 5 accepts after 1 warm-up. Headless Chromium (Playwright 1.60), Apple M5 Pro, macOS 26.

| Document | Paragraphs | Tracked changes | Accept → paint (1× CPU) | Accept → paint (4× CPU throttle) |
|---|---|---|---|---|
| `lease-25` (~25 pages) | 300 | 100 | ~80 ms | ~360 ms |
| `lease-100` (~100 pages) | 1,200 | 400 | ~215 ms | ~1.0 s |
| `lease-300` (~300 pages) | 3,600 | 1,200 | **1.3–4.4 s** | **~11.5 s** |

Tripling the document (100 → 300 pages) makes each accept **6–20× slower**.
The 300-page figures vary between runs, but the superlinear growth appears in every run.
4× throttling approximates a typical corporate Windows laptop.

1.43.1 behaves the same: ~80 ms / ~215 ms / 1.2–3.4 s.

## Where the time goes

CPU profile of one accept on `lease-300` (1.47.0, unminified build, 1×):

| Inclusive time per accept | Function |
|---|---|
| ~1,870 ms | total main-thread busy time |
| ~210 ms | `accept` → `decideSingle` (the accept itself) |
| **~1,280 ms** | `syncTrackedChangeComments` → `createCommentForTrackChanges` → `handleTrackedChangeUpdate` |
| ~970 ms | ↳ `getTrackChanges` → `findInlineNodes` → `descendants` / `nodesBetween` |
| ~255 ms | ↳ `findTrackedChangeById` → `commentsList.value.find(...)` |

The cause, from the 1.47.0 source:

1. After each accept, the comments store runs `syncTrackedChangeComments`, which calls
   `createCommentForTrackChanges(editor, superdoc, trackedChanges, { refreshExisting: true })`.
2. With `refreshExisting: true`, that loops over **every** remaining tracked change and
   calls `handleTrackedChangeUpdate` for each one.
3. Each `handleTrackedChangeUpdate` calls `getTrackChanges(docState, changeId)`.
   That walks **every inline node in the document** (`findInlineNodes(state.doc)`) and
   only then filters by id. Each call also runs `computeTrackedTableSummaryForState(docState)`
   and a linear `commentsList.value.find(...)`.

So one accept costs O(changes × document) + O(changes²). The per-change scan is
redundant: `syncTrackedChangeComments` has already computed the full
`trackedChanges` list once at the top.

### Possible fixes (suggestions only)

- Pass the already-computed `trackedChanges` (indexed by id) into
  `handleTrackedChangeUpdate` instead of re-running `getTrackChanges(docState, id)` per change.
- Compute `computeTrackedTableSummaryForState` once per sync, not once per change.
- Index `commentsList` by `commentId` / `importedId` / anchor key instead of a linear `find`.
- After a single accept/reject, refresh only the affected change rather than
  `refreshExisting: true` across all of them.

## Reproduce

Requirements: Node 20+.

```bash
npm install
npx playwright install chromium      # first time only, for the benchmark
npm run generate                      # writes public/lease-{25,100,300}.docx
```

**Interactive:** run `npm run dev` and open `http://localhost:5173/?doc=lease-300`. Click
**Accept next change**. Each row is accept → paint in ms. Record a Chrome
DevTools Performance profile while clicking to see the stack above.

**Headless benchmark:**

```bash
PROFILE=1 npm run build              # unminified + source maps so profiles show SuperDoc's names
npm run bench                        # 1× CPU
npm run bench -- --throttle 4        # 4× CPU throttle
```

This writes `results/summary-x{1,4}.md` and a `.cpuprofile` per document. You can
load these in Chrome DevTools > Performance. `sample-profiles/` contains the 1.47.0 profiles used
for the table above.

## What the repro does

- `scripts/make-lease.mjs` generates minimal valid DOCX files: `[Content_Types].xml`, rels and
  `word/document.xml` only. There are no styles or numbering parts, so any real-world
  document will be at least as expensive.
- `src/main.js` initialises SuperDoc the way a typical review integration does
  (`role: "editor"`, `documentMode: "editing"`, `onCommentsUpdate`), creates the
  `superdoc/ui` controller, subscribes to `ui.trackChanges`, and accepts the first remaining change
  via `ui.trackChanges.accept(id)`.
