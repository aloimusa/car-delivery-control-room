# Road Desk

An operations control room for Bahn's Car Delivery Control Room challenge (Prompt Operations Hackathon, 24–25
October 2026). Road Desk puts human decisions, agent work and external follow-ups in one queue across the 100
fictional orders. A road-support agent gathers evidence, handles routine questions and prepares approval-gated
decisions; a dossier service gives every model the same text about an order; a phone line lets drivers and pickup
desks talk to it.

Three rules hold everywhere: the agent never contacts customers; nothing real is booked or sent; a person decides
anything with consequences.

| | |
|---|---|
| ![Needs you: the agent's card first, then what the records raise](screenshots/queue.png) | ![The order page with the agent's decision card and its draft to the dealer](screenshots/order-card.png) |
| **Needs you.** The agent's card leads; below it, what the records raise for a person. | **The order.** One card: what happened, the recommendation, the draft (not sent), and Send, Edit, I'll handle it, Tell the agent instead or Reject. |
| ![The map of every delivery](screenshots/map.png) | ![The driver's phone: safety line first, then the agent's questions](screenshots/driver.png) |
| **The map.** Every delivery on its route; red needs a person, amber is worth a look. | **The driver's phone.** The stop instruction went out before the agent's first word, in the driver's language. |

## Setup in one line

Both services need one secret: an OpenRouter key. Copy `starter/.env.example` to `starter/.env` and
`dossier/.env.example` to `dossier/.env`, put the key in `OPENROUTER_API_KEY` in each, and leave the rest; every other
line has a working default. In `starter/.env` also set `AGENT_MODEL=deepseek/deepseek-v4-pro` and
`SIM_DRIVER_MODEL=deepseek/deepseek-v4.1-flash`, because the code's default when they are unset is a far more
expensive model (`docs/SETUP.md` says why). The phone line's speech in and out runs on the same key through
OpenRouter, so no GPU is needed anywhere.

## Run from a fresh clone

Node.js 24 or newer, npm, Docker with Compose.

```sh
cd starter && cp .env.example .env && npm ci
docker compose up -d --wait && npm run db:push && npm run db:seed && npm run attachments:seed
npm run dev                                  # http://localhost:3000
```

In a second terminal, the call and dossier service (order dossiers, the agent's calls, suggested replies, delivery
runs); the app works without it, those features then read as unavailable:

```sh
cd dossier && cp .env.example .env && npm ci && npm run serve     # 127.0.0.1:8799
```

Open http://localhost:3000, then `/demo` → **Reset demo** → **A. Fresh warning light**, with the driver's phone at
`/driver?driver=drv-042` in a second window. `docs/DEMO.md` is the whole script.

## Documentation

| Read | For |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | from clone to running, locally and on a server; env files; seed data; `tools/deploy.sh`; the autodeploy timer |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | the two services, Postgres, the phone line; which model does which job; the single-context design; the case engine, the gate and the triggers |
| [docs/DEMO.md](docs/DEMO.md) | a presenter's script: which pages in which order, what to say, what is simulated, known rough edges |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | services and ports, logs, the sandbox and the night harness, costs per run, what to do when something is stuck |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | the dataset, the app's `cr_` tables, the call service's files; how an order's dossier is assembled |
| [docs/HOW-AGENTS-RUN.md](docs/HOW-AGENTS-RUN.md) | the audit of the two agent designs and the review that led to the single context |
| [RUN-SHEET.md](RUN-SHEET.md) | the live demo, click by click, with times |

Background: `PARTICIPANT-BRIEF.md` (what to build and how it is judged), `OPERATIONS-CONTEXT.md` (the fictional
operations and evidence boundaries), `BAHN-CONCEPT.md`, `BUSINESS-CASE.md`, `PLAN.md`, `PROCESS.md` (how the team
worked with coding agents: what was asked, checked and thrown away), `dataset/SCHEMA.md` (the packet's records and
links), `starter/rulebook/` (the playbooks the agent follows), `dossier/docs/` (the dossier service's own notes).

## Repository guide

- `starter/`: the control-room app (Next.js, TypeScript, Drizzle, Postgres). Pages, API routes, the case agent
  (`lib/agent/`), cases and effects (`lib/cr/`), the simulation (`lib/sim/`), read-only projections (`lib/present/`),
  the night harness (`scripts/night/`).
- `dossier/`: the call and dossier service (Node, zod). Dossiers, the reasoning step, call briefs, simulated calls,
  suggested replies, delivery runs.
- `tools/deploy.sh`: deploys a checkout onto a server; `tools/phone-line/`: the speech-in decoder for the phone server.
- `dataset/`: the packet's synthetic records; `attachments/`: 58 synthetic documents, receipts and photos;
  `python3 check_packet.py` checks the packet's integrity.
- `docs/`: the documentation above. `screenshots/`, `video/`, `mockups/` (the original starter, not the current
  product).

## Checks

From `starter/`: `npm run typecheck`, `npm run build`, and with the app running `APP_URL=http://localhost:3000 npm
run smoke` and `npm run attachments:smoke`. Database tests and the end-to-end role play are in `docs/SETUP.md`. From
`dossier/`: `npm run check`.

All orders, people, documents, messages, GPS and OBD samples, providers, quotes and bookings are fictional. No real
customer message, booking or payment is sent. This is a prototype with role selection, not a production identity or
dispatch system; its locks assume one server process.
