# Road Desk application

This folder is the control-room app: pages, API routes, the case agent (`lib/agent/`), cases and effects
(`lib/cr/`), the simulation (`lib/sim/`), the read-only projections every page uses (`lib/present/`) and the night
harness (`scripts/night/`).

The documentation lives one level up:

- [../README.md](../README.md): the front door and the one-line setup.
- [../docs/SETUP.md](../docs/SETUP.md): from clone to running, env files, ports, seed data, tests, deploy.
- [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md): what is here and how it talks to the dossier service.
- [../docs/DATA-MODEL.md](../docs/DATA-MODEL.md): the dataset tables (`lib/schema.ts`), the `cr_` tables
  (`lib/cr/schema.ts`) and how they are read.
- [../docs/OPERATIONS.md](../docs/OPERATIONS.md): running it, logs, the night harness, costs.

## Start

Node.js 24 or later, npm and Docker with Compose.

```sh
cp .env.example .env          # add OPENROUTER_API_KEY, AGENT_MODEL, SIM_DRIVER_MODEL (see ../docs/SETUP.md)
npm ci
docker compose up -d --wait   # Postgres 5438, attachment store 9009 (console 9010)
npm run db:push
npm run db:seed
npm run attachments:seed
npm run dev                   # http://localhost:3000
```

The Compose file uses three ports on this computer: 5438 for Postgres, 9009 and 9010 for the attachment store. If
one is in use, change it in `compose.yaml` and update `DATABASE_URL` or `S3_ENDPOINT` in `.env` to match.

`db:seed` **replaces** the dataset tables in one transaction after checking every manifest count. It refuses when a
table of yours has a foreign key into the dataset tables; the app's own tables (`cr_*`) have none. Run it again after
changing the JSONL files, or point it elsewhere with `DATASET_DIR=/path npm run db:seed`.

## Scripts

| Command | What |
|---|---|
| `npm run dev`, `npm run build`, `npm start` | the app |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:push`, `npm run db:seed`, `npm run attachments:seed` | schema, dataset, files |
| `npm run smoke`, `npm run attachments:smoke` | read checks against a running app (`APP_URL=…`) |
| `npm test` | the database tests; run them on a disposable seeded database |
| `npm run e2e:roles -- [A B C D F G H customer]` | every role through the demo stories with the real model |
| `npm run night -- --style compliant\|clumsy [--only a,b] [--out dir]` | the night harness against the sandbox |
| `npm run agent:scenario-a`, `npm run sim:seed-routine` | headless scenario A; routine telemetry (both use the model) |
| `npm run cr:reset-schema` | drops and recreates the `cr_` tables (development only) |

## API, in short

Read routes: `GET /api/overview?q=`, `GET /api/orders/:id` (the record and its `view`), `GET /api/entities/:kind[/:id]`
(driver, customer, site), `GET /api/inbox`, `GET /api/reference-data`, `GET /api/orders/:id/attachments`,
`GET /api/chart`, `GET /api/chart/order/:id`, `GET /api/chart/replay?at=`, `GET /api/live/:ref` (what the dossier
service pulls), `GET /api/cases`, `GET /api/cases/:id`, `GET /api/agent/runs`, `GET /api/sim/state`.

Write routes: the channels (`/api/channels/driver/messages`, `/api/channels/site/messages`, `/api/channels/photos`,
`/api/channels/driver/milestone`), the agent's entry points (`/api/agent/telemetry`, `/api/agent/ask`,
`/api/agent/call-outcome`), the case decisions (`/api/cases/:id/proposals/:proposalId/decide`, `…/refresh`,
`/api/cases/:id/instruct`, `…/outcome`, `…/customer-answer`), the helpdesk (`/api/threads/…`, `/api/inbox/…`), the
simulation (`/api/sim/scenarios/:name`, `/api/sim/clock`, `/api/sim/autopilot`, `/api/sim/driver`), calls
(`/api/calls/run`, `/api/calls/sim`, `/api/calls/persona-turn`, `/api/line/link`) and `/api/cases/tick`.

Labels come from `lib/present/labels.ts`; the raw codes stay in the API. Every value on a page points back to a
record. Nothing in `lib/present/` is a source of truth.

All names, messages and events in the bundled dataset are fictional. The app uses Bahn's birch, asphalt and sand
colours and loads Unbounded, Poppins and Reddit Mono from Google Fonts, falling back to Arial without a network. It
does not bundle licensed brand fonts or copy Portal screens.
