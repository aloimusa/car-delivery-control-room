# Demo script

For a presenter with the stack running (`docs/SETUP.md`). About ten minutes. Everything below was read from the
pages' source; the timings are from the night runs (`starter/scripts/night/MORNING.md`): a DeepSeek agent turn takes
20 to 60 s, a follow-up after a decision another 30 to 90 s, a model-played call 20 to 60 s, a delivery run two to
six minutes.

## What is real and what is simulated

Say this once, early:

- **Real**: the language models. Every agent turn is a real tool-use loop; every card, message and call transcript
  on screen was written by a model during this session or an earlier one.
- **Fictional data**: all 100 orders, people, documents, messages, prices, quotes and bookings come from the
  challenge packet. Nothing is sent to a real customer; nothing real is booked.
- **Simulated world**: the clock (it starts at the dataset snapshot and moves by itself), GPS and OBD samples,
  the driver when nobody plays them, the other party on a simulated call, the customer's emails. The pages label
  these ("OBD dongle, simulated", "The model played both sides").
- **The decision is always a person's.** The agent never contacts a customer, never changes a date, price or
  booking, never tells a driver it is fine to drive on. It brings one card at a time.

## Before the audience arrives

1. App and dossier service up. `curl -s localhost:8799/health` answers; `/demo` loads.
2. `/demo` → **Reset the demo**. Reset refuses (409) while agent work or a call is running; wait and press again.
3. On `/demo`, switch the **simulated driver off** if a person plays the driver. Leave the **autopilot** on if you
   want the map to show the agent's own calls landing on other orders while you talk; off if nothing should happen
   that you did not start.
4. Tabs in this order: `/` (map), `/board`, `/orders/ord-00584`, `/inbox`, `/dealer`, `/demo`; the driver's phone
   `/driver?driver=drv-042` in a separate window (same laptop if the microphone is to be used; the line only works
   on the public host, see the end).

## The pages, in order

### 1. The map (`/`)

Every delivery on its route; a moving car is a vessel with a trail, red needs a person, amber is worth a look. Click
a car: the right-hand panel is the operator's dossier for that order (`app/components/chart/dossier.tsx`): state and
headline, **Needs you** when something does, the journey strip, the car's fault block when the dongle reports one,
**Recent** and **Watching**, and an action strip with the calls the agent may place now and the ones a person must
make (`/actions/<ref>` on the dossier service).

Say: a person should see only the orders that need them. The headline and the watch lines come from the same
dossier text the agent, the line and the helpdesk read.

**"400 orders?"** — the toggle at the bottom right, left of Replay. It draws three hundred made-up orders beside the
real hundred, along the real corridors, and a banner says so (`app/components/chart/crowd.ts`). It answers "what does
this look like at full operation" and nothing else: the crowd exists only in the browser, has no records, and the
strip counts say which numbers are invented. Switch it off before clicking a car.

**Replay** — the scrubber at the bottom right replays the stored phone fixes: each car sits where its last stored
fix at the chosen time put it; no fix then, no car (`/api/chart/replay`). Nothing is interpolated.

### 2. All orders (`/board`)

One lane per status, every order a card: the car, the reference, the customer, the route, the date that decides the
next step, and up to three work lines. "Needs a person" filters to the cards a person is waiting on; the lane counts
say how many. Search by reference, plate, customer, vehicle or city.

### 3. One order (`/orders/ord-00584`, scenario A's Bentley; `/orders/CD-420584` works too)

Top to bottom: the car and the headline, **Needs you** (the agent's card first, then what the dataset's own
records raise), the four tiles, the route, the conversations, the evidence, the agent's work and the latest
activity. Then the fold **"Everything on this order"**: route details stop by stop, alerts, work items and incidents,
drivers, the driver market, travel, costs, proofs and documents, prior agent work and the full history
(`app/components/record/records.tsx`). Say: the page shows the shape; the fold and the order API hold the depth.
Every value links back to a record; every date has its zone.

### 4. The headline scenario: A. Fresh warning light

`/demo` → **A. Fresh warning light** → Run. Then watch, in this order:

- **The driver's phone**: the stop and engine-off lines arrive at once, in the driver's home language with English
  below, before the model has read anything. Within about 30 s the agent asks whether they are safe.
- The driver (you, in the phone window) types: *"I'm safe, parked at the service area by the fuel station, engine
  off. The orange light was blinking and the car shook."* The agent answers, never "you can drive on", and asks for
  a dashboard photo. **Send demo picture** if it asks.
- **`/queue`** (Needs you): the Bentley at the top. Open it: one card. Ask the dealer how they want the car
  recovered; every fact with its source chip; the ferry cutoff; what is unknown.
- Choose an option → **I'll handle it** → log *"Called the owner: their own roadside help arrives at 11:00 UTC and
  takes the car to the Bentley workshop nearby."* The agent tells the driver what happens next and puts the case into
  a wait with a next check time.

Say: the safety line never waits for the model; every message to a driver is screened; the recovery decision was
the dealer's and the operator's, not the agent's.

### 5. Inbox and helpdesk (`/inbox`)

Every conversation the desk can read and answer: threads filed on orders and the support mail that arrived before an
order link was certain. Filters: waiting for our reply, all open, no order yet, closed. Open a thread: the composer
offers **suggested replies** from the dossier service, each with a stance (answer, ask, hold, escalate, identify), the
dossier items it rests on, and a caution where the facts are thin. Nothing is sent by itself; the operator picks,
edits and sends.

Good one to show: `/demo` → **The customer writes** → pick an order and send a sentence. It lands on the order's
case and in the inbox; the agent drafts the reply as a card a person approves. A German email gets a German draft.

### 6. The dealer desk (`/dealer`)

You are the desk at a pickup site. Pick a site: its booked collections, what a readiness call would ask, and whether
the agent may call this desk at all (a desk that belongs to the paying customer is never called by the agent; a
person calls). The call button on a collection opens the call screen with Mira calling and you answering as the desk.

### 7. The call pickup desk and "Simulate both sides"

The call screen (`app/components/line/call-screen.tsx`) is the live Road Desk line: Mira speaks, you answer into the
microphone, captions appear for both sides. **Simulate both sides** is the same live call with the model answering
for the other party, switchable back to the microphone. After hang-up the transcript is handed to the dossier
service, claims are extracted citing turns, the call is reviewed, and it appears on the order's panel on the map and
in the order's activity.

Where to start a call from: the map panel's action strip ("Call the driver", "Call the pickup desk"), the dealer desk,
or the driver's phone ("Call Road Desk", an inbound call).

**The line needs the phone server behind `/line/*` on the public host.** On a laptop without it the screen says the
line is unavailable; use the **call simulator** on `/demo` instead, where the model plays both sides on the dossier
service and the result comes back with audio when `SIM_TTS=1`.

### 8. Calls the agent places by itself

`/demo` → **Autopilot** lists what is due (a quiet phone on a moving car, a ferry check-in closing, a pickup slot
with unverified access, a driver who has not started) and what was called. Every call leaves two lines on the
order's timeline: "Calling Rafael (position check): no position from the driver's phone since 02:12", then what was
said and the outcome.

**Delivery run** (right column on `/demo`): the dossier service walks one order through its phases; at each step the
rules derive what is due, the reasoning step reads the dossier only when that changed, and every due check is placed
as a call the model plays on both sides. Choose how the other parties behave (cooperative, confused, rushed, wrong
fact). Two to six minutes, a few cents.

### 9. Backups if asked

- **"What if the customer has to agree?"** Scenario B: on the case, **Tell the agent** a plan and ask for a new
  window; approve the card; `/demo` → **The customer writes** *"Friday works for us, we agree."* The order's Delivery
  promise block quotes the email; **Customer agreed** moves the promise. An operator's approval alone never does.
- **"What if nobody answers?"** Scenario F, then **+5 min** twice: one reminder, then a card to call the driver.
- **"Routine?"** Scenario C: a keys question answered from the site record, handled without a person or with one
  card when the record's contact is unconfirmed.
- **The whole journey**: Scenario H, with the driver's phone (Kasper Darevik): at the pickup, collected with demo
  pictures, checked in, at the delivery, handed over to a named receiver. Press Run again after each step to move the
  clock. Reset first; H moves the clock by days and refuses while other cases are open.

## Known rough edges

Read before presenting. Each was seen in the 24–25 October runs (`starter/scripts/night/MORNING.md`, the full
delivery-run check of 25 October) and some have been addressed since; check the current build before relying on
either.

- A model turn is slow enough to notice. Talk over it; the timeline fills as the agent works.
- The card may take a minute to appear after the driver's reply. Open the order; the lookups show as they happen.
- Reset refuses while anything is in flight. Wait 30 to 60 s.
- A browser tab opened before a deploy still runs the old bundle; reload.
- Simulated-call ids are built from the simulated minute and the twist, so running the same delivery run twice
  overwrites the earlier call record rather than adding one.
- The call review can mark a correct spoken time as an "unsupported number"; a FAIL verdict on a call is worth
  reading before it is believed.
- The simulated other party in a call tends to confirm the dossier's own numbers rather than give new ones.
- The reasoning step's headline can disagree with a simulated delivery step ("delivered" versus "no tracking update
  for 24 hours") because the simulated handover is not visible to it.
- Speech for simulated calls is billed per character and is not included in the run's `costUsd`.
- The microphone needs a secure origin; on a laptop that is `localhost`.
- The helpdesk's internal note and the agent's `update_case` summary are free text that later readers see as
  context; nothing checks them.
