# Data model

Three layers hold data: the dataset (read-only), the app's own `cr_` tables (everything the demo adds), and the
dossier service's files (calls, audio, runs). This page names the main entities, where each lives, and how an
order's dossier is assembled from all of them.

## The dataset (read-only)

The packet in `dataset/data/*.jsonl`, 48 collections; `dataset/SCHEMA.md` explains every field and link. `npm run
db:seed` (`starter/scripts/seed.ts`) loads it into Postgres in one transaction after checking each collection's row
count against `manifest.json`:

- **Typed tables** for the core collections (`starter/lib/schema.ts`): `customers`, `sites`, `addresses`,
  `vehicles`, `drivers`, `orders`, `order_items`, `conversations`, `messages`, `alerts`, `operational_events`, plus
  `dataset_metadata` (the snapshot time).
- **`related_records`** (`collection`, `id`, `order_id`, `details` JSONB) for every other collection with its full
  fields: `time_windows`, `transport_plans` / `transport_points` / `transport_segments` (the route), `work_assignments`
  and `assignment_steps` (who drives, which steps), `travel_options` / `travel_reservations` / `travel_confirmations`
  (quotes, bookings, gate scans), `tracking_observations`, `custody_*`, `proofs`, `documents`, `site_visits`,
  `expenses`, `incidents`, `work_items`, `endpoint_claims`, `order_endpoint_details`, `support_inbox_threads` /
  `support_inbox_messages`, `order_notes`, `agent_proposals`, `internal_notifications`, `market_offer*`, `operators`,
  `agents`, ferry terminals and road estimates.

The main entities, in the dataset's words:

| Entity | Where | Notes |
|---|---|---|
| **Order** | `orders` | `reference` `CD-xxxxxx`, status `NEW` → `WAITING_FOR_PICKUP` → `IN_TRANSIT` → `DELIVERED` (or cancelled), customer, pickup and delivery address and optional managed site, readiness state |
| **Legs** | `transport_segments` per `order_items`, with `transport_points` | the app's "journey" (`lib/present/record.ts`) joins each segment to the `work_assignments` on it and the latest `tracking_observations`; a `JourneyLeg` is a presentation type (`lib/present/types.ts`), not a table |
| **Driver and assignment** | `drivers`, `work_assignments`, `assignment_steps` | the active assignment is `ASSIGNED` or `IN_PROGRESS` |
| **Windows** | `time_windows` | the selected pickup slot and the customer delivery promise, each with who set it; a SYSTEM or OPS window is not customer agreement |
| **Travel** | `travel_options` (quotes), `travel_reservations` (bookings), `travel_confirmations`, `ferry_terminal_events` (gate scans) | a quote is not a booking; a booking is not a gate scan |
| **Incidents, alerts, work items** | `incidents`, `alerts`, `work_items` | signals and owned work; an alert is a reason to look, not a diagnosis |
| **Conversations** | `conversations`, `messages`; `support_inbox_threads`, `support_inbox_messages` | inbox threads carry `candidate_order_ids` (hypotheses) and `linked_order_ids` (confirmed) |
| **Attachments** | `attachments/manifest.json`, files in the object store | `GET /api/orders/:id/attachments` returns metadata with 15-minute signed URLs (`lib/attachments.ts`) |

## The app's own tables (`starter/lib/cr/schema.ts`)

All prefixed `cr_`, no foreign keys into the dataset tables (so the dataset can be reseeded), order ids as plain text.
Everything a demo or a night pass adds lives here; **Reset demo** clears it.

| Table | Holds |
|---|---|
| `cr_cases` | one case per situation on an order: `kind` (`VEHICLE_WARNING`, `BREAKDOWN`, `ACCIDENT`, `DELAY`, `MISSED_CONNECTION`, `KEYS_ACCESS`, `EXPENSE`, `DRIVER_QUESTION`, `SITE_QUESTION`, `OPERATOR_QUESTION`, `HANDOVER`, `CUSTOMER_MESSAGE`), `status` (`NEEDS_DECISION`, `AGENT_WORKING`, `WAITING_EXTERNAL`, `HANDLED_BY_AGENT`, `RESOLVED`), urgency, owner, the driver, and the three fields every open case must have: `next_action`, `waiting_on` / `waiting_for`, `next_check_at`; plus `follow_ups`, `linked_records` (dataset items the case took over) and the last run's status for the watchdog |
| `cr_events` | the timeline: every message, voice turn, photo, telemetry snapshot, lookup, tool call, proposal, decision, effect, note and **milestone**, with actor, channel, recipient, plain-text body, `data` and `source_refs`. The driver's delivery steps (`ARRIVED_PICKUP`, `COLLECTED`, `CHECKED_IN`, `ARRIVED_DELIVERY`, `DELIVERED`) are `milestone` events overlaid on the snapshot (`lib/cr/lifecycle.ts`) |
| `cr_proposals` | decision cards: action type (`CONTACT_CUSTOMER`, `UPDATE_ETA`, `CHANGE_PROMISE`, `BOOK_RECOVERY`, `BOOK_TRAVEL`, `APPROVE_EXPENSE`, `REASSIGN_DRIVER`, `CLEAR_TO_CONTINUE`, `CONTACT_SITE_AS_CUSTOMER`, `OPERATOR_DECISION`), title, rationale, handover packet, changes, draft message, booking selection, evidence refs, **assumptions** (rechecked before execution; a changed one makes the card `OUTDATED` and a new revision is drafted), options, status, who decided and when, the chosen option, the edited draft, and a unique `execution_key` so a card executes at most once |
| `cr_effects` | executed changes layered over the dataset: `ETA_ESTIMATE`, `PROMISE_CHANGE`, `BOOKING`, `EXPENSE_DECISION`, `DRIVER_INSTRUCTION`, `MESSAGE_SENT`, `OUTCOME_LOGGED`; state `RECORDED`, `PROPOSED_TO_CUSTOMER`, `CUSTOMER_AGREED`, `CUSTOMER_DECLINED`, `UNCONFIRMED`; with authority and evidence. Only `CUSTOMER_AGREED` changes the effective promise (`lib/cr/effective.ts`) |
| `cr_telemetry` | simulated samples: `source` `OBD` or `PHONE_GPS`, `data` as `ObdData` or `GpsData`, `simulated` true |
| `cr_autonomy` | per action type: `ASK_FIRST`, `DO_AND_TELL` or `AUTO`, `locked` for customer contact |
| `cr_agent_runs` | every agent turn: audience, model, effort, input, tool calls, output, stop reason, usage, error |
| `cr_calls`, `cr_call_turns` (`lib/voice/schema.ts`) | the retired in-app voice interviewer's calls; kept because earlier demos' calls are read from them; nothing writes them now |

Source references (`SourceRef {kind, id, label, at}`) point from any fact to a dataset collection, a `cr_` table, a
knowledge file (`knowledge:dtc`, `rulebook:<playbook>`) or a mock provider. The UI prints the label as a chip.

## The dossier service's files (`dossier/data/out/`)

- `calls/<id>.json`: a `CallRecord` (`dossier/src/live.ts`): the brief it was given, direction, attempt, outcome
  (`COMPLETED`, `PARTIAL`, `NO_ANSWER`, …), engine (`SIMULATED_LLM` for model-played calls, `CHAINED_STT_LLM_TTS`
  for the live line), triage on inbound calls, turns, **slots** (every extracted value cites the turn and quotes it; a
  slot is a claim by the callee, never a verification), a tone review, `retryAfter`. Ids of model-played calls are
  built from the order, purpose, twist and simulated minute, so a rerun at the same simulated time overwrites.
- `audio/<callId>/<seq>.mp3`: one file per turn when `SIM_TTS=1`; the turn's `audioKey` is that path.
- `runs/<id>.json`: a `RunReport` (`dossier/src/run.ts`): planned steps, each step's derived items and diff, the
  reasoning output when the model was woken, the calls placed, model-only calls, failures, cost.

Calls are also visible to the app: `GET /api/calls?ref=` proxies the service, and the order's panel and activity show
them; the live-line link writes a `cr_events` note with the transcript (`app/api/line/link/route.ts`).

## How an order's dossier is assembled

The dossier is one typed document per order, built from records, loaded whole into the model, never fetched
piecemeal (`dossier/src/dossier.ts`). The steps:

1. **Load and validate the dataset** (`loadDataset`, `dossier/src/build.ts`): every `.jsonl` row is parsed with the
   generated strict schema for its collection (`records.generated.ts`, produced by `tools/gen_records.py` from
   `dataset/SCHEMA.md`); an unknown key, enum value or malformed time stops the load. Ids are indexed across
   collections.
2. **Collect the order's items** (`buildDossier`): explicit membership rules per collection, nothing guessed from
   text. Each item gets `membership` (`DIRECT` names the order, `JOINED` is reached through a link, `CANDIDATE` might
   concern it), `strength` from the one rule per collection in `strength.ts` (`REFERENCE`, `REQUEST`, `PLAN`, `QUOTE`,
   `BOOKING`, `COMMITMENT`, `CLAIM`, `OBSERVATION`, `VERIFIED`, `REJECTED`, `DECISION`, `SIGNAL`, `PROPOSAL`,
   `RECORD`), its primary time, and its **class** from `COLLECTION_CLASS` in `classes.ts` (`ORDER_CORE`, `ENDPOINTS`,
   `WINDOWS`, `ROUTE`, `MARKET`, `ASSIGNMENT`, `TRAVEL`, `MOVEMENT`, `CUSTODY`, `EVIDENCE`, `MONEY`, `SIGNALS`,
   `CONVERSATIONS`, `AGENT_WORK`, `HISTORY`, `DIRECTORY`). Every collection belongs to exactly one class; a missing one
   is a compile error. Dangling references are reported under `integrity`.
3. **Derive the phase** from the records and the clock (`derivePhase`): `INTAKE`, `READINESS`, `MARKET`, `BOOKED`,
   `PICKUP_DUE`, `MOVING`, `DELIVERY_DUE`, `AFTER`, `CANCELLED`, with its basis in words. A delivery run can overlay a
   status the world would have.
4. **Pull the live layer** (`pullLive`, `dossier/src/livepull.ts`): one `GET APP_URL/api/live/<ref>` (8 s timeout)
   returns the app's clock, the car's phone state, the last day of GPS and OBD rows, the timeline events, the cases
   and the helpdesk messages since the snapshot. `liveFromPayload` types every row through a zod schema
   (`GpsFix`, `ObdReading`, `AppEvent`, `AppCase`, `PhoneState` in `live.ts`); a row that does not fit is dropped and
   counted, never coerced. The service's stored calls for the order are added. When the app does not answer, the
   dossier is built without live data and says so (`pulledFrom: null`).
5. **Render** (`renderDossier`, `dossier/src/reason.ts`): a header naming the order and the strength ladder once;
   then one section per class, one line per item: `[collection id · strength · membership · time] field=value; …`,
   noisy fields skipped and each line capped at 700 characters, `HISTORY` capped at 25 items (10 for briefs, 20 for
   the line); then `CALLS` (purpose, callee, slots, triage), `TELEMETRY` (the latest six samples), `PHONE`, `APP
   TIMELINE` (the last 30 events), `OPEN CASES IN THE CONTROL ROOM`; and `AS OF` **last**, with the clock and the
   phase. Static records first and the clock last is deliberate: the long unchanged prefix stays in the prompt cache
   between turns.
6. **Derive** (`derive`, `dossier/src/derived.ts`): pure rules over the dossier, one table of thresholds
   (`THRESHOLDS`): `DUE_CHECK` (a readiness call 48 h before the slot, a start check 30 h before, a position check
   after 60 quiet minutes on a moving car, a ferry check-in 6 h before the cutoff; states `DUE`, `OVERDUE`, `RETRY`,
   `DONE`, `BLOCKED`), `DEADLINE_AT_RISK`, `SILENT_GAP`, `CONFLICT` (a call's claim against a record). Each item cites
   the dossier items it rests on. `diffDerived` between two builds is the only thing that wakes the reasoning model.

**`GET /dossier/:ref/text`** (`dossier/src/serve.ts`) is steps 1–6 as one text: `renderDossier(d)` followed by
`renderDerived(derive(d))`, live by default (`?live=0` for the snapshot only), with `x-as-of` and `x-live` headers.
This is the text the case agent puts first in its message, the reasoning step reads, the line's prompt ends with
(through `contextPrompt`, which adds the brief and the speaking rules in front), and the helpdesk's suggested replies
rest on. Measured on the snapshot a dossier is about 6 000 tokens at the median and 12 000 at most
(`dossier/docs/DOSSIER.md`).

### What gets written back, and how

Reading is one text for every model; writing is narrow on purpose (`docs/HOW-AGENTS-RUN.md`, "the write path"):

- the app writes cases, events, proposals, telemetry and helpdesk messages; the dossier pulls them, typed;
- the call service writes calls; a transcript's facts enter only as **claims that cite a turn**;
- the reasoning step's output, briefs and suggested replies are shown and kept in reports, never fed back as facts;
- writes are idempotent by id, so a rerun or a restart cannot double anything.
