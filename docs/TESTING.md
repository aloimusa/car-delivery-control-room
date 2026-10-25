# Testing

What checks exist, what each one needs, what makes it fail for reasons that are not yours, and how to read the
reports the checks produce.

## The test suite (`starter/`, `npm test`)

`npm test` is Node's own test runner over `lib/agent/*.test.ts`, `lib/cr/*.test.ts`, `lib/sim/*.test.ts` and
`lib/present/*.test.ts` (`starter/package.json`): 13 files, 19 suites, 137 tests, one file at a time
(`--test-concurrency=1`). It is loaded through `scripts/voice-register.mjs`, which stands in for the `server-only`
package that Next.js aliases at build time, so server modules import under `tsx`.

What it covers, by file:

| File | What it checks |
|---|---|
| `lib/agent/gate.test.ts` (48 tests) | the approval gate: a customer message never executes without a person, one card waits per case, the answer to a customer who wrote neither waits nor blocks, bookings keep the exact quote, outdated cards, double approvals, customer agreement before a promise moves |
| `lib/agent/loop.test.ts` (28) | one agent turn end to end with a scripted model: scenario A wiring, the drivability screen holding a reply, follow-ups after a decision, the dossier-first message |
| `lib/agent/drivability.test.ts` (13) | the pattern layer of the screen and the safety templates |
| `lib/agent/followup.test.ts`, `milestones.test.ts` | the silent-driver ladder; the driver's delivery steps as milestone events |
| `lib/cr/activity.test.ts`, `queries.test.ts` | the runtime-work counter that makes reset refuse; the case queries |
| `lib/sim/sim.test.ts`, `autopilot.test.ts` | the simulated clock, telemetry sync, scenarios; the autopilot's due checks and rate limit |
| `lib/present/*.test.ts` | the read-only projections: cases, bookings, text, the core view models |

No model is called: the loop tests install a scripted stand-in through `useTestLlm` (`lib/agent/client.ts`), so the
suite runs without `OPENROUTER_API_KEY`. It **does write to the database** it is pointed at (cases, events,
autonomy levels), which is why it wants a disposable one:

```sh
cd starter
docker compose exec db createdb -U controlroom controlroom_test
export DATABASE_URL=postgres://controlroom:controlroom@localhost:5438/controlroom_test
npm run db:push && npm run db:seed
CALL_SERVICE_URL=http://127.0.0.1:1 npm test        # see "what makes it fail"
```

About 35 s on a seeded database.

### What makes it fail, and why

Measured on 25 October against a freshly seeded disposable database:

- **137 of 137 pass** with no dossier service reachable.
- **135 of 137 pass** when a dossier service answers at `CALL_SERVICE_URL` (the default is the live one on
  `127.0.0.1:8799`). The two failures are in `loop.test.ts`, "scenario A wiring": *a fault opens a case and the
  agent contacts the driver first* and *I'll handle it, then the logged outcome lets the agent continue*. Both read
  the first text block of the model's first message and expect the case notes; with a service answering, that block
  is the rendered dossier (`<dossier as_of=…>`) and the notes are the second block (`loop.ts`, the dossier-first
  turn). The tests predate that change. Point `CALL_SERVICE_URL` at a closed port, or stop the service, and they pass.

The earlier working assumption of "about nine pre-existing DB-dependent failures" was not reproduced on a fresh
database. If you see failures of that kind, check in this order: the database is not freshly seeded (the gate
tests reset the autonomy table and the loop tests expect no open case on their orders; a database carrying demo
state fails differently each time); a dossier service is reachable; the tests are being run against the live or
sandbox database, which they must not be.

## Checks that need a running app

From `starter/` with the app up:

- `npm run typecheck` (`tsc --noEmit`) and `npm run build` (needs `DATABASE_URL`).
- `APP_URL=http://localhost:3000 npm run smoke`: compares one order's plans, points and segments in the API with
  the JSONL source, then fetches every board card and its order record and fails if they disagree on whether the
  order needs a person (`scripts/smoke.ts`).
- `APP_URL=http://localhost:3000 npm run attachments:smoke`: downloads one file of each format and checks its hash
  against `attachments/manifest.json`.
- `APP_URL=http://localhost:3000 npm run e2e:roles -- [A B C D F G H customer]`: plays the driver, the pickup desk,
  the customer and the operator through the demo stories with the **real model** (a few cents on DeepSeek per
  story), through the same routes the screens use, and checks what the records must show rather than the wording:
  a case, a card of the right kind, nothing sent to a customer without a person. It resets the demo before and
  between stories, so run it on demo data only. `KEEP=1` keeps the last story's records; `TRACE_DIR=…` files each
  story's agent runs and a timeline (`scripts/e2e-roles.ts`).

From `dossier/`: `npm run check` runs typecheck, record validation against the generated schemas, a strictness
check (malformed records must be refused), builds every dossier and runs the scripted simulated calls. No model.

## The night harness

`starter/scripts/night/` plays seventeen rulebook scenarios against a sandbox copy of the stack with a model acting
as driver, desk and customer and a scripted operator deciding every card. `COVERAGE.md` maps each rule in
`starter/rulebook/` to the scenarios that exercise it and how each is judged (a regex on every line to a driver, a
count of pending cards, a model judge on wording). `MORNING.md` is the first night's report.

How to run a pass and read its output is in `docs/OPERATIONS.md` ("The night harness"). The short form:

```sh
export NIGHT_APP=http://127.0.0.1:8798 NIGHT_DOSSIER=http://127.0.0.1:8800 NIGHT_DB=controlroom_sim
npm run night -- --style compliant|clumsy [--only a,b] [--out dir]
```

The output is `index.md` (one row per scenario: pass, fail, review, cost) and one page per scenario with a verdict
table and the log. **REVIEW is a judgement call for a person, not a failure.** A FAIL on "The scenario ran to its
end" is usually infrastructure. Each scenario first closes earlier cases on its order, so passes do not contaminate
each other.

The dossier side has its own soak: `cd dossier && npm run soak -- --sample 8 --budget 10` runs delivery runs one
after another and reads each report for garbage (`src/soak.ts`), stopping at the budget.

## Checks through the browser: Playwright

For anything a person would check by looking (a page renders, a button is where the script says, a call screen
goes through its states), the team used headless Chromium driven by Playwright, from a plain Node script, outside
the repo. Nothing in the repo depends on it. To do the same:

```sh
mkdir pw && cd pw && npm init -y && npm i playwright && npx playwright install chromium
```

```js
const { chromium } = require("playwright")
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: "http://127.0.0.1:3000" })
const page = await context.newPage()
await page.goto("/orders/ord-00584", { waitUntil: "networkidle" })
await page.screenshot({ path: "order.png" })
console.log(await page.$$eval("button", (b) => b.map((e) => e.innerText.trim())))
await browser.close()
```

Reading the DOM is more reliable than reading screenshots: the page's labels, `aria-label`s and `title`s are what
`docs/DEMO.md` quotes. Two things to know:

- The operator pages poll every few seconds and a deploy puts "A new version of Road Desk is ready. Reload" on
  screen; wait for `networkidle` after navigation and reload once if a deploy happened mid-run.
- Each `page.goto` of the map waits for the tiles; give it `timeout: 60000`.

### The call screen, with a microphone the browser does not have

The live line (`Start the call`, `Simulate both sides`) needs the phone server behind `/line/*`, which only
exists on the public host, and `getUserMedia`, which headless Chromium refuses. Give the page a silent microphone
before navigation:

```js
await context.addInitScript(() => {
  const fake = async () => {
    const ctx = new AudioContext()
    const dest = ctx.createMediaStreamDestination()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    gain.gain.value = 0
    osc.connect(gain); gain.connect(dest); osc.start()
    return dest.stream
  }
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: fake, enumerateDevices: async () => [] }, configurable: true })
})
```

With that, a script can open a call from the dealer desk (`button:has-text("Simulate outbound call")`), press
`.cs-btn:has-text("Simulate both sides")`, and watch the screen: the root is `.call-screen` with a phase class
`cs-idle` → `cs-checking` → `cs-composing` → `cs-connecting` → `cs-live` → `cs-ending` → `cs-ended` (or
`cs-failed`); captions are `.cs-cap` (`.cs-model` for Mira, `.interim` while still being written); `.cs-status`,
`.cs-note` and `.cs-hint` carry the state in words; `.cs-hang` hangs up; after hang-up `.cs-transcript` appears
with the claims once the dossier service has read the transcript. The composed prompt takes 5 to 10 s the first
time per order and purpose, a model-played call 20 to 60 s, the claims a few seconds more; keep each call under a
minute and run one at a time, the line serves one call at once. Another person using the site at the same time
sees the same call.

## Reading a worker report

The team's checks were run by workers (Claude Code sessions on the box) that each wrote a report in three parts.
The reports under `starter/scripts/night/MORNING.md`, `docs/HOW-AGENTS-RUN.md` and the end-to-end pass of 25
October follow the same shape, and so should yours:

1. **Done (verified).** Only what was checked where it is consumed: a page opened, a row read back from the
   database, an HTTP status and body, a file's bytes. Each claim names the file, URL or query it was checked
   against. "Written" is not "done".
2. **Unverified.** What was built or concluded but not checked at the consumer, and why: no browser, no key,
   another worker's area, time. Numbers quoted from someone else's report are listed here, with the source.
3. **Got wrong.** What the worker claimed and then had to retract, what the brief assumed that the code
   contradicted, and anything a reader could otherwise take as settled. A defect found in the product goes here
   too, ranked, with exact quotes.

When reading one: start from part 3, then check that every "done" in part 1 names its evidence; a tick without a
file or a URL behind it is a claim, not a result. A table of defects with quotes is worth more than a summary.
