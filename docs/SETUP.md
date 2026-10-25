# Setup

From a clone to a running Road Desk, locally and on a server. One secret is needed: an OpenRouter key.

## What you need

- Node.js 24 or newer and npm (`starter/README.md`; `@types/node` ^24 in `starter/package.json`).
- Docker with Compose, for Postgres and the attachment store (`starter/compose.yaml`).
- An OpenRouter key with credit. Without it the app still runs; agent cases hand over to a person with an
  explanation, simulated calls run scripted, and suggested replies are unavailable.
- Python 3 only for `python3 check_packet.py` (packet integrity) and for the phone line's decoder.

## Setup in one line

Copy `starter/.env.example` to `starter/.env` and `dossier/.env.example` to `dossier/.env`, put the key in
`OPENROUTER_API_KEY` in each, and leave the rest. Every other line has a working default.

The model lines in `starter/.env.example` are commented out on purpose: the code's defaults are the models the
project was measured with (`deepseek/deepseek-v4-pro` for the agent, `deepseek/deepseek-v4.1-flash` for the simulated
driver, `starter/lib/agent/client.ts`). Set them only to try something else.

The dossier service's defaults in code already match its `.env.example` (`REASON_MODEL=deepseek/deepseek-v4-pro`,
the flash model for the rest).

## Run locally

Three terminals, or two and a backgrounded Docker.

**1. Database, store, seed, app** (from `starter/`):

```sh
cd starter
cp .env.example .env            # add OPENROUTER_API_KEY, AGENT_MODEL, SIM_DRIVER_MODEL
npm ci
docker compose up -d --wait     # Postgres on 127.0.0.1:5438, attachment store on 9009 (console 9010)
npm run db:push                 # creates the dataset tables, the cr_ tables and the retired voice tables
npm run db:seed                 # loads dataset/data/*.jsonl; replaces the snapshot in one transaction
npm run attachments:seed        # uploads attachments/ to the store, checking each file against the manifest
npm run dev                     # http://localhost:3000
```

`db:seed` checks every collection's row count against `dataset/data/manifest.json` and refuses to run if your own
tables have foreign keys into the dataset tables (`scripts/seed.ts`). The `cr_` tables have none, on purpose.

**2. The call and dossier service** (from `dossier/`):

```sh
cd dossier
cp .env.example .env            # add OPENROUTER_API_KEY; APP_URL defaults to http://127.0.0.1:3000
npm ci
npm run serve                   # road-dossier service on 127.0.0.1:8799
```

The service reads the dataset through the symlink `dossier/data/dataset -> ../../dataset/data` (in the repo).
`SIM_TTS=1` in `dossier/.env` renders speech for simulated calls (ElevenLabs through OpenRouter; billed per
character). Leave it unset to keep simulated calls text-only.

**3. Check it** (from `starter/`, with the app running):

```sh
npm run typecheck
APP_URL=http://localhost:3000 npm run smoke
APP_URL=http://localhost:3000 npm run attachments:smoke
curl -s localhost:8799/health     # {"ok":true,"orders":100,"calls":N}
```

Open `/demo`, press **Reset demo**, then run **A. Fresh warning light** with the driver's phone
(`/driver?driver=drv-042`) in a second window. `docs/DEMO.md` has the whole script.

### Ports and how to change them

| Port | What | Where set |
|---|---|---|
| 3000 | the app (`next dev` / `next start`) | `-p` on the command line |
| 8799 | the call and dossier service | `PORT` in `dossier/.env`; `CALL_SERVICE_URL` in `starter/.env` if changed |
| 5438 | Postgres | `starter/compose.yaml` and `DATABASE_URL` |
| 9009, 9010 | attachment store API and console | `starter/compose.yaml` and `S3_ENDPOINT` |

The dossier service needs to reach the app (`APP_URL`) for the live layer; the app needs to reach the service
(`CALL_SERVICE_URL`). Both default to loopback.

### The simulation knobs (`starter/.env.example`)

- `SIM_NOW=2026-10-21T09:00:00Z`: the simulated clock starts at the dataset snapshot. At startup the app moves the
  clock past the newest stored record, so a restart does not land behind its own data (`lib/cr/clock-catchup.ts`).
- `HEARTBEAT_SECONDS=20`, `HEARTBEAT=off`: the server-side tick that keeps telemetry, timers and the autopilot
  running with no tab open.
- `AUTOPILOT=on|off`, `AUTOPILOT_PAUSE_SECONDS=120`, `AUTOPILOT_MAX_CALLS_PER_HOUR=10`: the agent's own calls.
- `SIM_DRIVER_ENABLED=true`: a model plays the driver in scenarios when nobody is in the driver window. Switch it off
  on `/demo` when a person plays the driver.

## Seed and simulated data

- The dataset is the packet's 100 fictional orders (`dataset/`, `dataset/SCHEMA.md`). `db:seed` is the only writer
  of the dataset tables. To see the app on changed data, copy `dataset/data`, edit, and run
  `DATASET_DIR=/path npm run db:seed`.
- Everything the demo adds (cases, events, cards, telemetry, milestones) lives in the `cr_` tables and is removed by
  **Reset demo** on `/demo` (`lib/sim/scenarios.ts`). Reset refuses while agent work or a call is in flight.
- `npm run sim:seed-routine` writes routine telemetry for the moving cars; `npm run agent:scenario-a` runs scenario A
  headless. Both use the real model and cost credit.
- The dossier service's own stores are files: `dossier/data/out/calls`, `audio`, `runs`.

## Tests

From `starter/`, against a disposable seeded database (the gate tests reset autonomy settings; keep them away from a
prepared demo):

```sh
docker compose exec db createdb -U controlroom controlroom_test
export DATABASE_URL=postgres://controlroom:controlroom@localhost:5438/controlroom_test
npm run db:push && npm run db:seed && npm test
```

About nine tests depend on database state and fail on a fresh database; they are known. `npm run e2e:roles` plays
the demo stories through the real routes with the real model (a few cents on DeepSeek).

From `dossier/`: `npm run check` runs typecheck, record validation, a strictness check, builds every dossier and runs
the scripted simulated calls; no model needed.

## Production build

```sh
cd starter && npm run build && npm start -- -p 3000 -H 127.0.0.1
cd dossier && npm run serve
```

`npm run build` needs `DATABASE_URL` to reach a database (pages are rendered against it). Put a reverse proxy with TLS
in front of the app; the dossier service stays on loopback.

## Deploying on a server: `tools/deploy.sh`

`tools/deploy.sh` deploys the checkout it is run from onto one box. It assumes two systemd **user** units already
exist, one for the app and one for the dossier service, and a Postgres container named `bahn-pg`. Its environment
variables, with their defaults at the top of the script:

| Variable | Meaning |
|---|---|
| `APP_DIR` | the live app checkout (a clone of this repo) |
| `DOSSIER_DIR` | the live dossier service tree, a separate directory |
| `APP_UNIT`, `DOSSIER_UNIT` | the user units to restart |

What it does, in order:

1. **Dossier service**: `rsync` this repo's `dossier/` over `DOSSIER_DIR`, keeping its `.env`, `node_modules` and
   `data/out` (stored calls, audio, runs); link `data/dataset` to this repo's `dataset/data`; `npm ci`; typecheck;
   restart the unit. If the unit does not exist it prints how to start the service by hand.
2. **App**: when `APP_DIR` is another checkout, fetch and check out this commit there (detached). Remove the previous
   build's generated route types (a removed route would otherwise fail the typecheck), `npm ci`, typecheck,
   `npm run build` (log in `/tmp/bahn-build.log`), restart the unit, wait up to 20 s for `GET /api/sim/state`.
3. **Clock**: read the newest `cr_telemetry.at` from the database and advance the simulated clock past it in steps
   of up to 120 minutes through `POST /api/sim/clock`. The app does the same at startup for both telemetry and events;
   the script keeps its version as a second guard.
4. Print the deployed commit and the status and time of a few pages, and the dossier service's `/health`.

Nothing in the script touches `.env` files or stored calls.

### An autodeploy timer (how the team's box does it)

The team's server runs a systemd user **timer** every two minutes that calls a small script. The script:

- holds a lock so two deploys never overlap;
- `git fetch`es the integration branch into a staging clone and compares the remote head with the last deployed
  commit recorded in a state file; if equal, it exits;
- otherwise checks out that commit on a `deploy` branch, runs `tools/deploy.sh` from it, and writes the new commit to
  the state file, logging to a file under the user's state directory.

Consequence: the live app checkout is **re-checked-out by the timer**; local edits there are lost on the next deploy.
Work in your own clone or worktree and push to the integration branch.

To do the same elsewhere: a `oneshot` service running the script, a timer with `OnBootSec=2min` and
`OnUnitActiveSec=2min`, `systemctl --user enable --now` on the timer, and `loginctl enable-linger <user>` so the user
units survive logout.

## The phone line

Live calls need the duplex phone server, which is not in this repository, and a reverse proxy that forwards `/line/*`
from the app's origin to it. `tools/phone-line/README.md` describes the speech-in decoder that runs on the OpenRouter
key (`asr_or.py`, env `OPENROUTER_API_KEY`, optional `PHONE_ASR_MODEL`). Without the line, every call screen says the
line is unavailable; chat and simulated calls still work.
