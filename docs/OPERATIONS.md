# Operations

Running the stack, reading its logs, the sandbox and the night harness, what a run costs, and what to do when
something is stuck. Ports below are the team's conventions; locally the app is on 3000 and the service on 8799.

## Services and ports

| Service | Process | Port | Health |
|---|---|---|---|
| the app | `npm start -- -p <port> -H 127.0.0.1` in `starter/` | 3000 locally; 8797 live, 8798 sandbox on the team's box | `GET /api/sim/state` (the clock and the moving cars) |
| the call and dossier service | `tsx src/serve.ts` in `dossier/` (`npm run serve`) | 8799 live, 8800 sandbox | `GET /health` → `{"ok":true,"orders":100,"calls":N}` |
| Postgres | Docker, `starter/compose.yaml` | 5438 on localhost | `docker compose exec db pg_isready` |
| attachment store | Docker, same file | 9009 (API), 9010 (console) | `curl 127.0.0.1:9009/health` |
| the phone line | outside this repo | reached under `/line/*` on the public host | the call screen's "line unavailable" message |

On the team's box both services are systemd **user** units (`systemctl --user status <unit>`); the sandbox pair are
transient units started with `systemd-run --user`. Each unit sets `WorkingDirectory` and reads the service's `.env`
(`EnvironmentFile=` for the dossier service; the app loads `starter/.env` itself).

Two databases: `controlroom` (live) and `controlroom_sim` (sandbox), in the same container. Never write to the live
one by hand and never migrate it; `db:push` and `db:seed` are for your own database.

## Logs

- Units: `journalctl --user -u <unit> -f`. The app logs the heartbeat start (`Road Desk: heartbeat every 20 s`), the
  clock catch-up at startup, and `Road Desk heartbeat:` warnings when a tick fails. The dossier service logs one line
  at start with the number of orders and stored calls.
- Agent runs: every turn is a row in `cr_agent_runs` (model, effort, input, tool calls, output, usage, error);
  `GET /api/agent/runs` lists the recent ones with the total spend. With `AGENT_TRACE_DIR` set, each run is also
  written as a file. (`/api/runs` and `/api/runs/:id` are the dossier service's *delivery runs*, proxied.)
- The dossier service's stores are files under `dossier/data/out/`: `calls/<id>.json`, `audio/<callId>/<seq>.mp3`,
  `runs/<id>.json`, `soak/<stamp>.md`. A run marked `running` when the service restarts is rewritten as `failed`
  with the reason.
- Spend: OpenRouter returns the dollar cost of each call in `usage`; the app sums it on `/api/sim/state`, the dossier
  service puts it on each run report, call job note and reason run.
- Deploys: the autodeploy script appends to a log file and keeps the deployed commit in a state file
  (`docs/SETUP.md`); `tools/deploy.sh` writes the app build log to `/tmp/bahn-build.log`.

## The sandbox stack

A second copy of both services against `controlroom_sim`, for the night harness and for anything that should not
touch live data. On the team's box, `sandbox-up.sh` (outside the repo, under the operator's home) does:

1. `rsync` the live dossier tree to a `-sim` copy and the live app checkout to a `-sim` copy, keeping each copy's
   `.env`, `node_modules`, `.next` and `data/out`;
2. `npm ci` and `npm run build` in the sim app, log to a file, stop on a failed build;
3. stop and `reset-failed` the two transient units, then `systemd-run --user` them: the dossier copy with
   `APP_URL=http://127.0.0.1:8798 PORT=8800`, the app copy with `CALL_SERVICE_URL=http://127.0.0.1:8800` on
   `-p 8798`;
4. wait for `GET :8798/api/sim/state` and `GET :8800/health`, print the clock.

The sim app's `.env` must point `DATABASE_URL` at `controlroom_sim`. The sandbox copies are rsynced from the **live**
trees, so they run whatever the autodeploy last deployed; `sandbox-up.sh` is run again after a deploy.

## The night harness

`starter/scripts/night/` plays the rulebook's scenarios against the sandbox with a model acting as driver, pickup
desk, delivery desk and customer, and a scripted operator deciding every card. `COVERAGE.md` maps each rule to the
scenarios that exercise it and how each is judged; `MORNING.md` is the report of the first night, with the ranked
faults and what was done about them.

**Run a pass** (from `starter/`, with the sandbox up):

```sh
export NIGHT_APP=http://127.0.0.1:8798 NIGHT_DOSSIER=http://127.0.0.1:8800 NIGHT_DB=controlroom_sim
npm run night -- --style compliant --out /path/to/out/pass1          # all 17 scenarios
npm run night -- --style clumsy --only routine-keys,missed-ferry      # a careless operator, two scenarios
```

- `--style compliant|clumsy`: the operator policy (`operator.ts`). The clumsy one double-approves, edits a clearance
  into a non-clearing instruction, gives nonsense instructions.
- `--only a,b`: scenario names from `scenarios.ts` (`misfire-customer-site`, `misfire-pushy-driver`,
  `light-monitor`, `routine-keys`, `silent-driver`, `site-question-direct`, `customer-site-contradiction`,
  `customer-email-german`, `late-driver-promise`, `line-hurt-driver`, `line-pushy-driver`, `line-fishing-driver`,
  `desk-contradicting`, `breakdown-chat`, `expense-question`, `keys-different-person`, `missed-ferry`).
- `NIGHT_PLAYER_MODEL` (default `deepseek/deepseek-v4.1-flash`) plays the people and judges the wording; the agent
  under test runs with the sandbox app's own models.
- `NIGHT_DATABASE_URL` lets the harness use a local `psql` instead of the Docker container for the few direct writes
  it needs (a customer writing in has no API).
- Each scenario first closes earlier cases on its order (`World.fresh`), so passes do not contaminate each other.
  The first night lost one pass to that before it was added.

The team's box runs passes through small chain scripts: wait for a running harness to finish, wait until the
autodeploy state file shows the wanted commit, `sandbox-up.sh`, then `npm run night` with the output under a
per-pass directory and the log beside it.

**Read the results.** The output directory has `index.md` and one page per scenario:

- `index.md`: one row per scenario with pass, fail and review counts, the players' cost, and an error column when the
  scenario did not run to its end. The cost column is the players' and judges' spend only; the agent's own spend
  shows on the sandbox app's `/api/sim/state`.
- `<scenario>.md`: a verdict table (check, PASS / FAIL / REVIEW, evidence) and the log of what every party said and
  what the case looked like after each step. REVIEW means a judgement call for a person, not a failure.
- `<scenario>.json`: the same, for scripts.

Start from the FAILs, then the REVIEWs. A FAIL on "The scenario ran to its end" is usually infrastructure (the sandbox
dossier lost its key, the app was mid-restart), not the agent.

**The dossier soak** (from `dossier/`): `npm run soak -- --sample 8 --twists cooperative,confused,rushed,wrong_fact
--budget 10` runs delivery runs one after another and reads each report for garbage (`src/soak.ts`); it stops at the
budget and writes `data/out/soak/<stamp>.md` as it goes. `--judge` re-reads stored runs without running new ones.

## Costs per run

Measured on 24–25 October with the DeepSeek models through OpenRouter. The agent's figures are sums of OpenRouter's
reported cost; the speech figure is the code's list-price note, not an invoice.

| What | Cost | Source |
|---|---|---|
| one agent turn (sandbox, all passes) | about $0.035 on average ($7.44 over 210 runs) | `scripts/night/MORNING.md`, Spend |
| one full night pass of 13–17 scenarios | about $1 of agent spend, plus under $0.20 for players and judges (pass 6: $0.12) | `MORNING.md`, Numbers; the pass 6 index |
| one dossier delivery run (TIMELINE, one call placed) | $0.0208 for the models, of which the call $0.0067; about 5 minutes | the full delivery-run check of 25 October |
| speech for that call (10 turns, 1 127 characters) | about $0.034 at $0.00003 per character; not in the run's `costUsd` | `dossier/src/tts.ts`, the same check |
| the dossier soak, 32 runs (4 twists × 8 orders) | $2.98, about $0.09 per run | `MORNING.md` |
| a call brief rewrite | seconds and cents on the flash model; the pro model with reasoning took 5–10 s | `docs/HOW-AGENTS-RUN.md` |
| the whole first night | about $10.6 of credit | `MORNING.md`, Spend |

Where the money goes: the case agent's turns dominate; a turn is up to 12 model calls with the whole dossier as a
cached prefix. The Haiku side calls (one word per driver message, one description per photo) are small. Speech is
billed per character and adds up on long calls: with `SIM_TTS=1` a ten-turn call costs more in speech than in
reasoning.

## When something is stuck

**The agent keeps bringing up the same decision, or marks cards outdated at once.** The simulated clock is behind
its own records (a restart re-anchored it at `SIM_NOW`). The app now catches the clock up at startup; if it still
reads behind the newest record, advance it: `POST /api/sim/clock {"minutes": N}`. `MORNING.md` fault 1.

**A case sits in AGENT_WORKING with nothing running.** The watchdog in `lib/agent/tick.ts` turns it into a card
("The agent couldn't finish") after 3 simulated minutes; it runs on every poll and heartbeat. If the clock is not
moving, see above.

**Reset refuses with 409.** Agent work or a call is in flight. Wait 30–60 s and try again. A reset also forgets a
call that is still on the line.

**The call screen says the line is unavailable.** Expected anywhere but the public host with the phone server behind
`/line/*`. Use the call simulator on `/demo` or chat. On the public host, `GET /api/line/warm?ref=…&purpose=…`
tells you whether the dossier service can compose the prompt (a 400 carries the reason the agent may not place that
call, for example the site belongs to the customer).

**Simulated calls, dossiers or suggested replies read as unavailable in the app.** The dossier service is down or on
another port: `curl localhost:8799/health`; check `CALL_SERVICE_URL` in `starter/.env`. The app never fails on it.

**The dossier has no live layer** (`x-live: false` on `/dossier/<ref>/text`). The service cannot reach the app at
`APP_URL`; the sandbox needs `APP_URL=http://127.0.0.1:8798`.

**A model-played call job never finishes.** Jobs live in memory; a service restart loses them. The stored call file,
if the call completed before the restart, is still under `data/out/calls`.

**`npm run typecheck` fails after a route was removed.** Delete `starter/.next/types` and `.next/dev/types`; the
deploy script does this.

**The build fails after a pull.** `npm ci` in both `starter/` and `dossier/`; the lockfiles move.

**409 Conflict from the dossier service on `POST /runs`.** A run for that order is already in progress; `GET
/runs?ref=<ref>` shows it.

**Nothing happens with no tab open.** `HEARTBEAT=off` is set, or the process is not the one serving the pages (the
heartbeat is per process). The app logs `heartbeat every N s` at start.

**The bug and health commands the team used on the phone are not this stack's.** `health` here is the service checks
above.
