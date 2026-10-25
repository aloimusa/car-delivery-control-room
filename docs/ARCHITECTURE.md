# Architecture

Road Desk is two services and a database, plus a phone line that lives outside this repository. This page says what
each piece does, what talks to what, and which model does which job. Every claim names the file it was read from.

```
                       browser (operators, the driver's phone, a pickup desk)
                                         │
                                         │ HTTP, same origin
                                         ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  starter/   the control-room app  (Next.js, :3000 in dev)        │
   │  pages: map, queue, orders, board, inbox, dealer, driver, demo   │
   │  lib/agent    the case agent: tool loop + approval gate          │
   │  lib/cr       cases, events, proposals, effects, telemetry       │
   │  lib/sim      the simulation: clock, fleet, autopilot, scenarios │
   │  lib/present  read-only projections for every page               │
   └───────┬───────────────────────────────┬──────────────────────────┘
           │ SQL (drizzle)                 │ HTTP, loopback
           ▼                               ▼
   ┌────────────────┐            ┌──────────────────────────────────────┐
   │ Postgres :5438 │            │ dossier/   the call and dossier      │
   │ dataset tables │◄───────────┤ service (plain node http, :8799)     │
   │ + cr_* tables  │ GET /api/  │ dossier text · reasoning step ·      │
   │ + object store │ live/<ref> │ briefs · simulated calls · suggested │
   │   :9009 (S3)   │            │ replies · delivery runs              │
   └────────────────┘            └───────────────┬──────────────────────┘
                                                 │ HTTPS
                                                 ▼
                                   OpenRouter: chat models, speech-to-text,
                                   ElevenLabs speech out
           ┌─────────────────────────────────────┐
           │ the phone line (not in this repo)   │  ◄── browser, via /line/* on the public host
           │ speech in → model with the dossier  │  ──► GET dossier/context/<ref>/<purpose>
           │ → ElevenLabs out                    │  ──► app POST /api/line/link after hang-up
           └─────────────────────────────────────┘
```

## The pieces

### The app (`starter/`)

A Next.js app. It owns the database schema (`lib/schema.ts`, `lib/cr/schema.ts`, `lib/voice/schema.ts`,
listed in `drizzle.config.ts`), every page, and the case agent.

- **Dataset tables** come from the challenge packet (`dataset/data/*.jsonl`), loaded by `scripts/seed.ts`. The seed
  flattens eleven core collections into typed tables and keeps every other collection in `related_records` as JSON.
- **`cr_` tables** are the app's own: cases, events, proposals, effects, telemetry, autonomy, agent runs
  (`lib/cr/schema.ts`). They have no foreign keys into the dataset tables, so the dataset can be reseeded without
  touching them. Executed changes are *overlaid* on the dataset through `lib/cr/effective.ts`; the dataset is never
  edited.
- **Attachments** (PDFs and photos from `attachments/`) sit in an S3-compatible store started by
  `starter/compose.yaml`, read through `lib/object-store.ts` with short-lived signed URLs.
- **The simulation** moves a simulated clock from the dataset snapshot (`SIM_NOW`), writes simulated GPS and OBD
  samples into `cr_telemetry`, and runs the case timers. A heartbeat in the server process does this every
  `HEARTBEAT_SECONDS` (default 20) even with no tab open (`instrumentation-node.ts`); the operator pages' polls do the
  same work.

### The call and dossier service (`dossier/`)

A single-file HTTP server (`src/serve.ts`) on loopback, port `PORT` (default 8799). It loads the dataset itself from
`dossier/data/dataset`, a symlink to `../dataset/data`, and validates every row against generated strict schemas
(`src/records.generated.ts`). Its routes, as listed at the top of `src/serve.ts`:

| Route | What |
|---|---|
| `GET /dossier/:ref[?live=1]` | the typed dossier for one order; `live=1` pulls the app's records and clock first |
| `GET /dossier/:ref/text[?live=0]` | the dossier as text, the one context every model reads (see below) |
| `GET /derived/:ref[?live=1]` | the rule layer: due checks, deadlines at risk, silent gaps, conflicts |
| `GET /actions/:ref` | what an operator can do now: which calls the agent may place, which a person must |
| `GET /reason/:ref` | the reasoning step's typed output, cached per order until `?fresh=1` |
| `GET /brief/:ref/:purpose`, `/card/…`, `/context/…` | a call brief; the brief as a small model's prompt; the brief plus the whole dossier as the line's prompt |
| `POST /calls/run`, `POST /calls/sim`, `POST /calls/persona-turn`, `POST /calls/ingest` | simulated calls (both sides played), one persona turn for the live line, a live transcript handed in after hang-up |
| `GET /calls[?ref=]`, `/calls/:id`, `/calls/:id/review`, `/calls/:id/audio/:seq` | stored calls, their review, their audio |
| `POST /runs`, `GET /runs[?ref=]`, `/runs/:id`, `/runs/plan/:ref` | delivery runs (see "Triggers") |
| `POST /suggest/:ref` | suggested replies for the helpdesk |

Calls, audio and runs are stored as files under `dossier/data/out/` and reloaded at start, so a restart keeps them.

The app reaches the service through `lib/present/call-service.ts` and a few API routes; every call tolerates the
service being down, and the pages then say that calls or dossiers are unavailable.

### Postgres

One database, `controlroom`, in Docker (`starter/compose.yaml`, port 5438 on localhost). The dossier service does
**not** read the database. It reads the dataset files and asks the app for the live layer over HTTP
(`GET /api/live/<ref>`, `starter/app/api/live/[order]/route.ts`), which returns the simulated clock, the car's phone
state, the last day of telemetry, the timeline events, the cases and the helpdesk messages written since the snapshot.

### The phone line (`tools/phone-line/`)

Live calls run on a separate duplex phone server that is not in this repository. The browser reaches it same-origin
under `/line/*`; a reverse proxy in front of the public host forwards that path and adds the phone server's
authentication (`starter/app/components/line/call-screen.tsx`). Without that proxy the call screens say the line is
unavailable, and the driver uses chat.

The line has one contact, `roaddesk`. On each turn: speech in, a chat model that holds the order's dossier as its
system prompt, ElevenLabs speech out. The app's part:

- `GET /api/line/warm?ref=&purpose=` asks the dossier service for `/context/<ref>/<purpose>?by=model` before the call
  is placed, so the prompt is ready when the phone fetches it (`app/api/line/warm/route.ts`).
- `POST /api/line/link` after hang-up: the transcript goes to the dossier service's `/calls/ingest`, which extracts
  typed claims that cite turns and reviews the call; the call is then linked to the order as a timeline event
  (`app/api/line/link/route.ts`).
- `GET /api/line/config` names the contact (`app/api/line/config/route.ts`).

Speech in used a local Whisper on a GPU. `tools/phone-line/asr_or.py` replaces it with OpenRouter's transcription
endpoint (`POST /api/v1/audio/transcriptions`, default model `mistralai/voxtral-small-transcribe-3-0`, fallback
`openai/gpt-transcribe`), so the whole line needs only the OpenRouter key. `tools/phone-line/README.md` says how to
drop it into the phone server. Speech out is `elevenlabs/eleven-v4-turbo` through OpenRouter's speech endpoint, the
same model and the same voice the dossier service uses for simulated calls (`dossier/src/tts.ts`).

"Simulate both sides" on a call screen is the same live call with the model answering for the other party: the
browser asks the dossier service for the other party's next line (`POST /calls/persona-turn`) and plays it into the
call (`call-screen.tsx`, `dossier/src/serve.ts`).

## Which model does which job

All models are reached through OpenRouter. The app uses the Anthropic SDK against OpenRouter's
Anthropic-compatible endpoint (`starter/lib/agent/client.ts`); the dossier service uses OpenRouter's chat completions
API directly (`dossier/src/reason.ts`, `chat()`).

| Job | Variable | File | Value in `.env.example` | Default in code when unset |
|---|---|---|---|---|
| The case agent | `AGENT_MODEL` | `starter/lib/agent/client.ts` | `deepseek/deepseek-v4-pro` | `anthropic/claude-opus-5.5` |
| Simulated driver (demo) | `SIM_DRIVER_MODEL` | `starter/lib/agent/client.ts` | `deepseek/deepseek-v4.1-flash` | `anthropic/claude-haiku-5.5` |
| Drivability screen (one word per driver message) | `DRIVABILITY_MODEL` | `starter/lib/agent/drivability.ts` | `anthropic/claude-haiku-5.5` | `anthropic/claude-haiku-5.5` |
| Photo descriptions | `VISION_MODEL` | `starter/lib/agent/vision.ts` | `anthropic/claude-haiku-5.5` | `anthropic/claude-haiku-5.5` |
| Dossier reasoning step; Mira in simulated calls; transcript extraction | `REASON_MODEL` | `dossier/src/reason.ts`, `llm-call.ts` | `deepseek/deepseek-v4-pro` | `deepseek/deepseek-v4-pro` |
| The other party in a simulated call | `CALLEE_MODEL` | `dossier/src/llm-call.ts` | `deepseek/deepseek-v4.1-flash` | `deepseek/deepseek-v4.1-flash` |
| Call brief rewrite | `BRIEF_MODEL` | `dossier/src/reason.ts` | `deepseek/deepseek-v4.1-flash` | `deepseek/deepseek-v4.1-flash` |
| Suggested helpdesk replies | `SUGGEST_MODEL` | `dossier/src/suggest.ts` | `deepseek/deepseek-v4.1-flash` | `deepseek/deepseek-v4.1-flash` |
| Speech out | `TTS_MODEL` | `dossier/src/tts.ts` | `elevenlabs/eleven-v4-turbo` | `elevenlabs/eleven-v4-turbo` |
| Night harness players and judges | `NIGHT_PLAYER_MODEL` | `starter/scripts/night/lib.ts` | — | `deepseek/deepseek-v4.1-flash` |

The intended split is: the pro model for anything that reasons over a dossier, the flash model for anything that
rewrites or role-plays, and Haiku for the two things DeepSeek cannot do on OpenRouter (read a photo; answer the
one-word drivability screen on every outbound driver line).

**Note the first two rows.** In `starter/.env.example` the model lines are commented out. The code's default for
`AGENT_MODEL` when nothing is set is `anthropic/claude-opus-5.5`, about ten times the cost of the DeepSeek model the
rest of the project was measured with. Set `AGENT_MODEL` and `SIM_DRIVER_MODEL` explicitly (see `docs/SETUP.md`).

Effort: `AGENT_EFFORT_FAST` (default `low`) for driver, voice and site turns; `AGENT_EFFORT_DEEP` (default `medium`)
for operator turns. A turn makes at most 12 model calls and 16 000 output tokens (`starter/lib/agent/config.ts`).

## The single-context design

The dossier service renders one text per order and every reader gets the same text:

- the **reasoning step** (`dossier/src/reason.ts`, `reason()`): system = rules + output schema, user = the rendered
  dossier + the derived items + the callable parties; output validated against a zod schema, up to three attempts;
- **Mira on the line and in simulated calls** (`dossier/src/context.ts`, `contextPrompt()`): speaking rules, the
  brief, the hard rules, then the whole rendered dossier;
- **suggested replies** (`dossier/src/suggest.ts`): the thread and the rendered dossier;
- **the case agent in the app** (`starter/lib/agent/loop.ts` around line 471): every turn fetches
  `GET /dossier/<ref>/text?live=1` (`starter/lib/agent/dossier-text.ts`, six-second timeout) and puts it in the
  **first block of the first user message**, marked for prompt caching, with the case notes after it. While a dossier
  is present the four record-reading tools (`get_order_context`, `get_timeline`, `get_telemetry`, `get_active_codes`)
  are not offered (`DOSSIER_COVERS` in `starter/lib/agent/tools.ts`). When the service does not answer, the turn runs
  with the tools as before.

`renderDossier` (`dossier/src/reason.ts`) writes the static records first, grouped by information class with the
evidence-strength ladder explained once at the top, then the live layer (stored calls, the latest six telemetry
samples, the phone state, the last 30 app events, open cases), and the clock **last**, so the long unchanged prefix
stays cacheable between turns. `docs/DATA-MODEL.md` has the details.

## The case engine and the gate

The case agent (`starter/lib/agent/`) is a classic tool loop: `runTurn` in `loop.ts` builds the case notes, calls
the model with tools until it is done, passes every tool call through the gate, and delivers the final text to
whoever the turn is for. Runs are serialised per case (`withCaseLock`).

- **Audiences**: `driver`, `site`, `operator`. The audience decides tone, which tools are offered
  (`TOOL_AUDIENCES` in `gate.ts`) and what the agent may see.
- **Tools** (`tools.ts`): read tools (`get_order_context`, `get_timeline`, `get_telemetry`, `get_active_codes`,
  `lookup_trouble_code`, `lookup_warning_light`, `analyse_photo`, `find_nearby_help`, `search_travel_options`,
  `read_playbook`) and acting tools (`message_driver`, `request_photo`, `safety_instruction`, `ask_site`,
  `update_case`, `wait_for`, `hand_over`, `propose_action`, `escalate`, `close_case`).
- **The gate** (`gate.ts`) enforces in code what the brief says in words: the agent never contacts a customer on its
  own (`CONTACT_CUSTOMER` and `CONTACT_SITE_AS_CUSTOMER` are locked to ask-first, `LOCKED_ACTIONS` in
  `lib/cr/types.ts`); nothing changes without approval unless an operator raised that action type's autonomy; drivers
  and sites only reach their own order; safety instructions come only from fixed templates (`drivability.ts`); an
  approval is bound to the revision the operator saw, rechecked against the current facts, and executed at most once
  (`execution_key` on `cr_proposals`).
- **Decision cards**: a proposal (`cr_proposals`) with an action type, a rationale, a handover packet, assumptions,
  options and, where it applies, a draft message. Statuses: `PENDING`, `OUTDATED` (an assumption changed; nothing
  ran; the agent redrafts), `APPROVED`, `EDITED_AND_APPROVED`, `REJECTED`, `EXECUTED`, `FAILED`, `UNKNOWN_OUTCOME`.
  **One pending card at a time**: while a card waits the agent may not raise a second one; a pending
  `OPERATOR_DECISION` is treated as the twin of any new one (`gate.ts`; `scripts/night/MORNING.md` faults 4 and 12).
- **Operator decisions** come through `POST /api/cases/:id/proposals/:proposalId/decide`: approve, approve with an
  edited draft, reject with a note, "I'll handle it" (then `outcome` logs what happened), "Tell the agent instead"
  (`instruct`), and a read-only "Ask the agent" box (`ask`, which gets only the read tools). Each one is an entry
  point in `triggers.ts` and runs a follow-up turn with the operator audience.
- **Every message to a driver is screened** (`drivability.ts`): a pattern layer, then a one-word classifier. Anything
  that reads as permission to drive on is held, the driver gets a fixed line, and a `CLEAR_TO_CONTINUE` card goes to
  an operator when a fault or restriction is on the job.
- **Serious case kinds** (`VEHICLE_WARNING`, `BREAKDOWN`, `ACCIDENT`, `DELAY`, `MISSED_CONNECTION`) always end with
  a person; the agent cannot close them (`SERIOUS_KINDS` in `gate.ts`).

## Triggers

Nothing in the app fires on a schedule except the heartbeat. A turn starts when:

| Trigger | Entry point | What happens first |
|---|---|---|
| a driver writes (chat or voice) | `POST /api/channels/driver/messages` → `handleDriverMessage` | the message is stored on the case; a message that reports fire, smoke or injury gets the 112 template before the model reads it |
| a site writes | `POST /api/channels/site/messages` → `handleSiteMessage` | lands on the case that waits for them, or the open incident case, else a new `SITE_QUESTION` |
| the customer writes (simulated email) | `/demo` → `handleCustomerMessage` | filed on the case and in the conversations; an operator-side turn drafts the reply as a card |
| the car reports a fault | `POST /api/agent/telemetry` | the stop instruction goes out in the driver's language before the model's first word (`02241f7`) |
| an operator decides, logs an outcome, instructs or asks | `/api/cases/:id/…` | the decision is recorded, then a follow-up turn |
| a timer | `tick()` in `lib/agent/tick.ts`, called by every poll and by the heartbeat | waiting on the driver: one reminder, then a card; waiting on a site, customer or provider: a note, then hand over; a run stuck for 3 simulated minutes: "the agent couldn't finish", as a card |
| the autopilot | `lib/sim/autopilot.ts`, from the heartbeat | places the agent's own check-up calls through the dossier service: a quiet phone on a moving car, a ferry check-in closing, a pickup slot with unverified access, a driver who has not started; rate-limited (`AUTOPILOT_PAUSE_SECONDS`, `AUTOPILOT_MAX_CALLS_PER_HOUR`); what a call finds that needs a decision goes to the agent as a follow-up |

On the dossier side the loop is: build the dossier as of now → derive → diff against the last build → wake the
reasoning model only when the derived layer changed → place the due checks as calls → the claims are live input for
the next build (`dossier/src/run.ts`, `dossier/docs/RUN.md`). A **delivery run** (`POST /runs`) walks one order
through its key instants in `TIMELINE` mode, or does one tick as the app sees it in `LIVE` mode.

## Rules of the product, where they live in code

- The agent never contacts customers: `gate.ts` (`draftReachesCustomer`, `LOCKED_ACTIONS`), `reason.ts`
  (`callableParties`: proposed calls to anyone else become watch lines), `context.ts` (`MUST_NOT_WORDS`).
- Nothing real is booked or sent: `lib/agent/mocks.ts` provides the simulated providers; every outbound message is a
  row in `cr_events` and the simulated email is marked `simulated: true`.
- A person decides anything with consequences: proposals, autonomy levels in `cr_autonomy`, and the serious case
  kinds that cannot be closed by the agent.
