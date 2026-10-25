# How the agents run, and which model does what

An audit of the system as deployed on the box on 25 October (branch `polish`). Two things people assume that are not
quite true: not everything computes on a whole dossier, and not everything is DeepSeek v4 pro. There are two separate
agent designs in this repo, plus a phone line that borrows from one of them.

## The two designs

### 1. The case agent in the app (`starter/lib/agent`)

A classic tool-using loop. It never sees a dossier. It sees what its tools return.

- **Model:** `AGENT_MODEL`, on the box `deepseek/deepseek-v4-pro`, called through OpenRouter with the Anthropic SDK (`client.ts`).
  Effort `low` for a driver or site turn, `medium` for an operator turn (`AGENT_EFFORT_FAST/DEEP`). Up to 12 model calls per
  turn, 16 000 output tokens, two attempts on a cut-off answer (`config.ts`, `loop.ts`).
- **Context per turn:** the system prompt (role, how to work, the whole rulebook from `starter/rulebook/*.md`, the
  audience preamble: driver, site or operator) plus one user message with the case notes, the clock and the
  conversation. Everything else it has to fetch with tools: `get_order_context`, `get_timeline`, `get_telemetry`,
  `get_active_codes`, `lookup_trouble_code`, `lookup_warning_light`, `read_playbook`, `find_nearby_help`,
  `search_travel_options`, `analyse_photo`; and act with tools: `safety_instruction` (fixed templates only),
  `message_driver`, `ask_site`, `request_photo`, `update_case`, `wait_for`, `hand_over`, `propose_action`, `close_case`.
  The approval gate (`gate.ts`) sits between every tool call and the database.
- **State:** Postgres (`cr_cases`, `cr_events`, `cr_proposals`, `cr_telemetry`). A turn is one agent run on one case under
  a per-case lock. Follow-up turns (prepare a decision after `hand_over`, continue after an operator's decision) are
  queued after the turn and run the same loop with the operator audience.
- **Triggers (`triggers.ts`):** a driver message, a site message, a telemetry fault, an operator decision, outcome,
  instruction or question. **Timers (`tick.ts`):** every poll of the control room compares open cases with the simulated
  clock: a reminder when a driver is silent, a card when they stay silent, a watchdog for a run that died.
- **Side calls, not DeepSeek:**
  - the drivability screen (`drivability.ts`): a pattern layer, then a one-word classifier on `DRIVABILITY_MODEL`, which is
    **unset on the box, so the default `anthropic/claude-haiku-5.5`** runs on every message to a driver, and twice when the
    message carries a stop instruction;
  - photo descriptions (`vision.ts`): `VISION_MODEL`, also unset, so **`anthropic/claude-haiku-5.5`** (DeepSeek takes no images on
    OpenRouter);
  - the simulated driver (`lib/sim/sim-driver.ts`): answers the agent in the driver channel from a fact sheet, on
    `SIM_DRIVER_MODEL`, on the box `deepseek/deepseek-v4-pro`; on in the box's env (`SIM_DRIVER_ENABLED=true`).

So "one agent, one context" does not describe this part: a driver turn is the loop model plus a Haiku classifier per
outbound message, plus Haiku once per photo.

### 2. The dossier service (`dossier/src`)

This is the part that matches the mental model: one typed document per order, a model that reads all of it, and typed
output appended back. No tools, no loop.

- **The dossier (`build.ts`, `dossier.ts`):** the dataset's records for the order, typed and graded by evidence
  strength, plus a live layer pulled from the app in one HTTP call (`livepull.ts`): cases, events, telemetry, helpdesk
  messages since the snapshot, and the stored calls. `renderDossier` turns it into the text the model reads.
- **The derived layer (`derived.ts`):** rules, no model: due checks, deadlines at risk, silences, conflicts, gaps.
- **The reasoning step (`reason.ts`):** **`REASON_MODEL` = `deepseek/deepseek-v4-pro`**, one call, system = rules + output
  schema, user = the rendered dossier + the derived items + the callable parties. Output: headline, watch lines, a
  needs-person card, proposed calls, a note. Validated against a zod schema, up to three attempts, then post-processed
  (uncallable calls become watch lines, record ids leave the prose). A delivery run (`run.ts`) wakes this step only
  when the derived layer changed.
- **Call briefs (`brief.ts`, `composeBrief` in `reason.ts`):** the rules build a draft brief (what Mira may state, what to
  ask, the closing line). The model rewrites it into speakable lines: since today on **`BRIEF_MODEL`, default
  `deepseek/deepseek-v4-flash`, hidden reasoning off** (3 s; it was the pro model with reasoning, 5 to 10 s). Cached per
  order and purpose until the service restarts.
- **The line's prompt (`/context/<ref>/<purpose>`, `context.ts`):** the brief **and the whole rendered dossier with its
  stored calls**. This is what Mira holds for the entire call, whether on the phone line or in a simulated call. The
  brief is not a substitute for the dossier; it is the speakable summary on top of it.
- **Simulated calls (`llm-call.ts`):** Mira's lines on **`REASON_MODEL` (pro)** with the `/context` prompt; the other party
  on `CALLEE_MODEL`, default **`deepseek/deepseek-v4.1-flash`**, from a persona built from the dossier under a twist;
  after the call, a typed extraction of the transcript into claims on the pro model. Audio per turn with
  **`elevenlabs/eleven-v4-turbo` through OpenRouter** (`SIM_TTS=1`, set on the box today).
- **Suggested replies (`suggest.ts`):** **`SUGGEST_MODEL`, default `deepseek/deepseek-v4-flash`**, with the thread and the
  rendered dossier; returns up to three drafts with their basis records and a desk note.
- **Review (`review.ts`):** deterministic, no model.

### 3. The phone line (`duplex/phone/callers/roaddesk.py` on the box, outside this repo)

One contact, `roaddesk`: local **Whisper `small.en`** for speech in, **`deepseek/deepseek-v4-pro`** through OpenRouter for the
turn (streaming, hidden reasoning off), with the system prompt fetched from the dossier service's `/context` (brief +
whole dossier), and **`elevenlabs/eleven-v4-turbo`** through OpenRouter for speech out. After hang-up the app links the
transcript to the order and the dossier service extracts claims from it (`/calls/ingest`). The older VoiceChat and
PersonaPlex contacts exist on the phone server but nothing in the app offers them, and their units are inactive.

## Where the two designs meet

- The case agent writes cases, events and proposals to Postgres. The dossier service pulls them as the live layer, so
  the dossier model sees what the case agent did, typed.
- The dossier service stores calls and claims. The app shows them on the order and in the map panel; the case agent
  can read call turns through `get_timeline`.
- The helpdesk's suggested replies and the line's prompt come from the dossier service; the case agent does not use
  them.

## What this means for "only DeepSeek, only whole dossiers"

| Where | Model on the box | Sees |
|---|---|---|
| Case agent turn | DeepSeek v4 pro, low/medium effort | case notes + tool results |
| Drivability classifier | **Claude Haiku 5.5** (unset env, default) | one message + a trusted safety context |
| Photo description | **Claude Haiku 5.5** (unset env, default) | one photo |
| Simulated driver (demo) | DeepSeek v4 pro | a fact sheet + the agent's question |
| Dossier reasoning step | DeepSeek v4 pro | whole dossier + derived layer |
| Call brief rewrite | DeepSeek v4 flash, no reasoning | the rule-built draft + the dossier |
| Mira on the line / in a simulated call | DeepSeek v4 pro | brief + whole dossier |
| The other party in a simulated call | DeepSeek v4.1 flash | a persona sheet |
| Transcript extraction | DeepSeek v4 pro | the transcript |
| Suggested replies | DeepSeek v4 flash | thread + whole dossier |
| Speech in / out | Whisper small.en (local) / ElevenLabs v4 turbo | audio |

Two decisions to make: whether the two Haiku side calls should move to DeepSeek flash (set `DRIVABILITY_MODEL` and
`VISION_MODEL`; the classifier is a one-word answer, the vision call needs a model that takes images, which DeepSeek on
OpenRouter does not), and whether the case agent should read the dossier service's rendered dossier as its first tool
result instead of assembling the same facts from eight tools.

## Review: is what each model sees the right thing?

Short answer: the dossier half is the right design; the case agent half is not, and the two should be one.

**What is right.** One typed document per order, graded by evidence strength, with a rule-built derived layer that
decides when the model is woken, and typed output appended back. The model never has to discover what exists: it
reads everything and answers a closed schema. That is why the reasoning step is auditable (every line cites a record),
why the soak could judge it mechanically, and why the line and the simulated calls say the same things as the
headline on the map: they read the same text. Keep this.

**What is not.** The case agent assembles its own picture of the order from up to eight read tools on every turn.
That costs 3 to 12 model calls per turn, it re-derives facts the dossier already holds in typed form, and it can
disagree with the dossier view the operator is looking at (the "codes have cleared" incident last night came from a
tool reading a different frame than the event the agent was told about). Its only real need for tools is to **act**:
message the driver, ask the site, propose, wait, hand over, close. Reading should come from the dossier.

**Three specific gaps.**

1. *Two sources of truth for the same order.* The case agent reads Postgres through its tools; the dossier service
   reads the dataset plus a live pull of that Postgres. Each turn of the case agent should start with the rendered
   dossier as its first (and usually only) read, fetched from the dossier service, with the eight read tools kept
   only for things the dossier cannot carry (a nearby-help search, a travel quote, a photo).
2. *The brief as a separate model step.* It exists because the voice model on the line was once a small model that
   needed a short card. The line now runs the pro model with the whole dossier, so the brief only adds the
   "may state / must not / closing" frame. The rules already build that frame deterministically; the flash rewrite
   is cheap and improves wording, so keep it, but it should not be a reason to wait: the rule-built draft can open the
   call and the rewrite can land on the next turn.
3. *Three models where two would do.* DeepSeek v4 pro for anything that reasons over a dossier (the reasoning step,
   Mira, extraction, the case agent), DeepSeek v4.1 flash for anything that rewrites or role-plays (briefs, suggested
   replies, personas, the demo driver). Haiku stays for the two things DeepSeek cannot do on OpenRouter: see a photo,
   and answer the one-word drivability screen cheaply on every outbound line. Done today in code and in the box's env.

**What I would not change.** The derived layer waking the model only on change; typed outputs with citations; the
approval gate in code rather than in a prompt; the safety templates. Those are the parts that made the night's faults
findable and fixable.
