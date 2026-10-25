# Demo script

For a presenter with the stack running (`docs/SETUP.md`). About ten minutes. Labels in **bold** are quoted from the
pages as rendered on 25 October; the timings are from the night runs (`starter/scripts/night/MORNING.md`): a
DeepSeek agent turn takes 20 to 60 s, a follow-up after a decision another 30 to 90 s, a model-played call 20 to 60 s,
a delivery run two to six minutes.

The top-right switch picks a role: **Operator**, **Driver**, **Dealer**, **Bahn** (the demo controller). The
operator's navigation is **Map**, **Needs you**, **All orders**, **Inbox**, **How the agent works**, **Customers**,
**Drivers**, **Places**. Every page's footer says "Fictional data · nothing real is booked or sent".

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
2. `/demo` → **Reset demo** ("Remove every case, message, decision and telemetry sample we added … and restart the
   sim clock at 09:00 UTC on 21 Oct"). Reset refuses (409) while agent work or a call is running; wait and press
   again.
3. On `/demo`, switch the **Simulated driver** off if a person plays the driver (the page itself says "Keep this off
   in the live demo: a teammate plays the driver"). Leave **Autopilot** on if you want the map to show the agent's
   own calls landing on other orders while you talk; off if nothing should happen that you did not start.
4. Tabs in this order: `/` (map), `/board`, `/orders/ord-00584`, `/inbox`, `/dealer`, `/demo`; the driver's phone
   `/driver?driver=drv-042` in a separate window (same laptop if the microphone is to be used; the line only works
   on the public host, see the end).

## The pages, in order

### 1. The map (`/`)

Every delivery on its route; a moving car is a vessel with a trail, red needs a person, amber is worth a look. The
strip at the bottom left shows the simulated clock ("Wed 21 Oct 12:33:38 UTC, simulated") and the fleet at a glance
("24 moving · 17 booked · 1 pickup due · 1 delivered today"); the pill at the top, "N need a person · most urgent
…", opens the queue, with **Show all N**.

Click a car: the right-hand panel is the operator's dossier for that order. From the top: the car, the reference and
route, the customer and driver; the action strip **Call the driver** (title: "Mira, Bahn's assistant, calls <name>
on the Road Desk line; you answer as them"), **Call the receiver · a person**, **Contact the customer · a person**;
the headline ("Selma is near the delivery address in Leipzig, expected Wed 13:10, inside the 13:00 to 15:00
promise."); the journey bar with Pickup, Now and Delivery; a **Needs you** block when something does, with **Open
the conversation** and a fold **How it got here**; the car's fault block when the dongle reports one; **RECENT** and
**WATCHING**; folds **Full history** and **Full dossier**; and **Open the full order →** at the bottom.

Say: a person should see only the orders that need them. The headline and the watch lines come from the same
dossier text the agent, the line and the helpdesk read.

**400 orders?** — the button at the bottom right, left of **Replay** (title: "Show the map with 400 orders: 300
simulated ones beside the dataset's 100"). It draws three hundred made-up orders beside the real hundred, along the
real corridors, and a banner says exactly what they are: "400 orders. 300 of them are simulated for scale: not in
the dataset, no pages, no cases, no calls. Click one to see what a node carries." The crowd exists only in the
browser. Switch it off before clicking a real car.

**Replay** (title: "Replay the stored phone fixes") opens a scrubber: each car sits where its last stored fix at the
chosen time put it; no fix then, no car (`/api/chart/replay`). Nothing is interpolated.

### 2. All orders (`/board`)

Titled **Orders**: "100 orders · 24 moving · 24 need a person". One lane per status (**New orders**, **Ready to
post**, **Finding a driver**, **Driver assigned**, **Moving**, **Delivered**, **Cancelled**), every order a card: the
car, the reference, the customer, the route, the date that decides the next step, and up to three work lines. The
toggle **Needs a person N** filters to the cards a person is waiting on; each lane header counts its own. Search
"Reference, car, plate, customer or city".

### 3. One order (`/orders/ord-00584`, scenario A's Bentley; `/orders/CD-420584` works too)

Top to bottom, as rendered: the breadcrumb **Map / CD-420584**; the same action strip as the map panel with the
promise beside it; the car, reference, route, customer and status; **JOURNEY** (the progress bar); **Route** (pickup
and delivery as two cards with the leg, distance, driver and ETA between them); a fold **Closed cases on this
order**; **Timeline** ("Recorded messages and events, with the live case log. Each line names its source", with
**Show N earlier records**); **Ask the agent** ("Answers with sources. It never changes anything from here", button
**Ask**); then **The order** ("Everything below is from the order record"): the facts and tiles, **Conversations**
with **New conversation**, **Evidence**, **Prior agent work**. When a case is open its decision card sits above the
timeline.

The fold **Everything on this order** ("Folded away. Open what you need; the order API has every field") holds, as
rendered: **Order facts**, **Route details** ("2 stops with slots, contacts, access state, site procedures and
proofs"), **Alerts, work items and incidents**, **Drivers**, **Driver market**, **Travel**, **Costs**, **Proofs,
documents and custody**, **Prior agent work and room activity**, **All events** ("the recorded history by day, with
what each event changed"). Say: the page shows the shape; the fold and the order API hold the depth. Every value
links back to a record; every date has its zone.

### 4. The headline scenario: A. Fresh warning light

`/demo` → **Scenarios** → **A. Fresh warning light · CD-420584** → **Run** (**Show the driver** beside it opens the
driver's phone). The scenario text on the page: "The Bentley on its way from Cologne to the Hamburg ferry gets a
flashing check-engine light and loses power … the agent contacts the driver first." Then watch, in this order:

- **The driver's phone**: the stop and engine-off lines arrive at once, in the driver's home language with English
  below, before the model has read anything. Within about 30 s the agent asks whether they are safe.
- The driver (you, in the phone window) types: *"I'm safe, parked at the service area by the fuel station, engine
  off. The orange light was blinking and the car shook."* The agent answers, never "you can drive on", and asks for
  a dashboard photo. **Send demo picture** if it asks.
- **`/queue`** (**Needs you**; the header counts "N need your decision (n with the agent's card ready) · n with the
  agent · n worth a look · n waiting"; sections **Needs your decision**, **Worth a look**, **Waiting**; a fold
  **Handled by the agent today**): the Bentley at the top. Open it: one card. Ask the dealer how they want the car
  recovered; every fact with its source chip; the ferry cutoff; what is unknown.
- Choose an option → **I'll handle it** (on a card whose action is a call the button reads **I'll make the call**) →
  log *"Called the owner: their own roadside help arrives at 11:00 UTC and takes the car to the Bentley workshop
  nearby."* The agent tells the driver what happens next and puts the case into a wait with a next check time.

Say: the safety line never waits for the model; every message to a driver is screened; the recovery decision was
the dealer's and the operator's, not the agent's.

### 5. Inbox and helpdesk (`/inbox`)

Every conversation the desk can read and answer: threads filed on orders and the support mail that arrived before an
order link was certain. Filters: **Waiting for our reply**, **All open**, **No order yet**, **Closed**, each with
its count. Open a thread: the composer has two tabs, **Reply to <name>** and **Internal note · desk only**, and the
buttons **Suggested reply** (title: "Replies suggested from this order's dossier and the thread. You pick, edit and
send.") and **Send**; **Open the order** and **Close thread** sit beside. A suggestion comes from the dossier
service with a stance (answer, ask, hold, escalate, identify), the dossier items it rests on, and a caution where
the facts are thin. Nothing is sent by itself; the operator picks, edits and sends.

Good one to show: `/demo` → **The customer writes** (subtitle "simulated email"; "Anything the agent drafts back
waits for a person before it goes out") → pick an order, pick or type a message ("We agree to the new delivery date
you proposed." is one of the canned ones) → **Send as the customer**. It lands on the order's case and in the inbox;
the agent drafts the reply as a card a person approves. A German email gets a German draft.

### 6. The dealer desk (`/dealer`)

Titled **Dealer**: "You are the desk at a pickup site. Pick the site you are playing." The list names each site with
its city and collection count; a desk that belongs to the paying customer is marked **Customer site · a person
calls** and the agent never calls it. Pick a site: **Booked collections N**, each with what a readiness call would
ask, and the button **Simulate outbound call**. That opens the call screen with Mira calling and you answering as
the desk.

### 7. The call pickup desk and "Simulate both sides"

The call screen is drawn as a phone. Its header says **SIMULATED CALL · NOTHING IS DIALLED**; then **Mira from
Bahn**, the purpose and order ("Pickup readiness · CD-420154"), **Ready to call**, and two lines of who is who:
"Mira from Bahn is played by the model from the order dossier." and "You play the desk at <site>. Mira from Bahn is
calling about the <car> collected <slot>. Answer as the desk would." Below: "Start the call to answer with your
microphone, or let the model answer for you; you can switch during the call." Buttons: **Start the call** (title:
"Mira calls; you answer with your microphone"), **Simulate both sides** (title: "The same live call; the model
answers for the other party"), **Close**. Beside the phone, **What Mira sets out to find** lists the questions.

On the call Mira speaks and captions appear for both sides; the model-answers / I-answer switch can be flipped
mid-call. After hang-up the transcript is handed to the dossier service, claims are extracted citing turns, the
call is reviewed, and it appears on the order's panel on the map and in the order's timeline ("Live call on the Road
Desk line with …, 0:48. Recorded on the phone line.").

Where to start a call from: **Call the driver** on the map panel or the order page, **Simulate outbound call** on
the dealer desk, or **Call Road Desk** on the driver's phone (an inbound call; its title: "A live call with Road
Desk's assistant on the turn-based line").

**The line needs the phone server behind `/line/*` on the public host.** On a laptop without it the screen opens as
above but the call cannot start; use the **Calls** section on `/demo` instead (see 8), where the model plays both
sides on the dossier service and the result comes back with audio when `SIM_TTS=1`.

### 8. Calls the agent places by itself

`/demo` → **Autopilot · N calls this session** ("Let the agent make its own check-up calls as the simulation runs:
a quiet phone on a moving car, a ferry check-in closing, a pickup slot with unverified access, a driver who has not
started.") lists what is due, or "Nothing is due." Every call leaves two lines on the order's timeline: "Calling
Rafael (position check): no position from the driver's phone since 02:12", then what was said and the outcome. The
page also says the scenario orders are left alone.

**Simulate a delivery** (right column on `/demo`): "The dossier service walks one order through its phases: at each
step the rules derive what is due, the reasoning step reads the dossier only when that changed, and every due check
is placed as a call the model plays on both sides." Pick an **Order** from the list, how the other parties behave
(**Cooperative**, **Confused**, **Rushed**, **Wrong fact**), then **Simulate this delivery**; "A run takes two to
six minutes and costs a few cents." Stored runs are listed below ("CD-420442 · cooperative · 25 Oct 10:32 UTC · 3
calls"), each opening its steps and transcripts.

**Calls** (same column): "Simulate the robo-calls the agent makes and takes. Both sides are simulated; nothing is
dialled." **Outbound checks** (pickup readiness, driver start check) and **Inbound: the driver calls in**, each a
stored persona; **Model** or **Scripted**, then **Simulate call**; **Simulate outbound call (you answer)** opens the
live call screen instead. A finished call shows **Mira's card** and **What the call established**.

Other things on `/demo`: **Sim time** with **+5 min**, **+15 min**, **+60 min**; "Agent spend so far: $x over n
runs"; **What happened** (the panel's own log); **Cars on the road N**.

### 9. Backups if asked

- **"What if the customer has to agree?"** Scenario B: on the case, **Tell the agent** a plan and ask for a new
  window; approve the card; `/demo` → **The customer writes** *"Friday works for us, we agree."* The order's Delivery
  promise block quotes the email; **Customer agreed** moves the promise. An operator's approval alone never does.
- **"What if nobody answers?"** Scenario **F. The driver goes silent**, then **+5 min** twice: one reminder, then
  a card to call the driver.
- **"Routine?"** Scenario **C. Routine question, no person needed**: a keys question answered from the site record,
  handled without a person or with one card when the record's contact is unconfirmed.
- **The whole journey**: Scenario **H. From pickup to handover**, with the driver's phone (Kasper Darevik): at the
  pickup, collected with demo pictures, checked in, at the delivery, handed over to a named receiver. H's button
  reads **Next step's time**: press it after each step to move the clock. Reset first; H moves the clock by days and
  refuses while other cases are open.

The driver's phone (`/driver`): "The driver's side of the story. No login in this prototype: pick who you are
playing." Lists **In the demo scenarios**, **On the road now**, **Upcoming work**. The phone shows the car's
simulated readings, the job, the delivery steps, the thread with Bahn, a photo button (**Send a photo**), the
message box ("Message Bahn") and **Call Road Desk**.

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
