# Road Desk: a car issue takes €2.5–6 of operator time instead of €15–28, plus about €0.12 of AI

| Per incident case (breakdown, new date, silent driver) | Today: a person does it all | With Road Desk |
|---|---|---|
| Operator time per case | 30–45 min | 5–10 min: read the card, decide, make the one call a person must make |
| Cases per operator-hour | 1.3–2 | 6–12 |
| Operator cost per case (€0.50–0.62/min) | €15–28 | €2.5–6 |
| AI cost per case (measured, 44 incident cases) | – | median €0.12, mean €0.20, stress cases up to €0.65 |
| AI cost per routine question (measured, 19 cases) | – | €0.001–0.05, median €0.01 |
| One phone call by the agent, speech included (measured) | – | about €0.05 |
| Agent work before a person looks (measured) | – | a driver turn in ~27 s, an operator card in ~80 s; a case runs 1–3 min |
| Month at ~2,100 deliveries (≈310 incidents + 2,100 routine questions) | ≈456 operator-h ≈ €17k | ≈56 operator-h ≈ €2.1k + €0.5k tech |

- **≈ €14k a month (84%) of first-line work saved**, about 3 FTE of hours. Range 67–90%: at 10% incidents and 30→10 min it is ≈ €5.6k; at 20% and 45→5 min it is ≈ €22k.
- **Break-even comes early:** the tech costs about €0.5k a month (agent €0.1k, calls and speech €0.3k, hosting €0.1k, no GPU) and pays for itself once it saves ~17 operator-hours a month. Even a model 10–15× dearer (EU-hosted for real driver data) keeps the AI under €2 a case, a tenth of today's operator cost. The costliest stress case (€0.65 of AI, a driver refusing to stop) equals ~1 min of operator time.
- **Peaks:** five incidents in one evening hour (say a cancelled sailing) are 2.5–3.75 h of work today, so 3–4 people, or the last driver waits ~3 h. With Road Desk one person clears them in 25–50 min, and each driver hears from the agent within a minute.
- **The person stays.** Every booking, customer message and drive-on clearance waits for a person, so one seat is always on duty (24/7 ≈ 5.4 FTE ≈ €27k a month either way). The hours saved become cash as staff not added for daytime load, peaks and growth: the same seat handles about 5× the cases per hour.
- **Caveats:** handling times are estimates, not measured at Bahn. AI costs come from simulated cases on synthetic data; the stress cases (pushy or silent drivers, contradicting desks) are harder than an average day. A model turn can take up to 2 min at busy hours. A wrong draft is stopped at the gate but still costs operator minutes.

<sub>€20/h gross + 19.9% statutory employer costs (2026) + paid leave and holiday bonus (×1.25 per worked hour) = €30/h by day, €37.5/h averaged over 24/7 with shift premiums. 15% of deliveries have an incident, one routine question per delivery. 1 USD = €0.89.</sub>

## The procedure the numbers describe (as built on 25 October)

1. **A trigger opens or wakes a case:** a driver message, a site message, a fault code from the car, a silent phone, an operator's decision. Customers never reach the agent and the agent never reaches them.
2. **The agent reads the dossier first.** Every turn starts with the same order text a person sees on "Everything on this order" (records, travel, calls, alerts, the clock), then uses tools only to look things up (trouble codes, playbooks, nearby help, travel options, a photo) or to act.
3. **Safety lines are templates, screened twice.** A stop instruction is a fixed text sent before anything else; every message to a driver passes a pattern check and a one-word classifier so that nothing reads as permission to drive on.
4. **The agent can speak on the phone line.** It calls the driver or the pickup desk from a brief it composes from the dossier, with speech in and out through OpenRouter (no GPU, no local models). Every call is recorded into the dossier with audio and reviewed by a second model for forbidden lines (prices, customer details, mechanical advice).
5. **One decision card at a time.** Anything with consequences (a tow, a new date, a drive-on clearance, a message to a customer) becomes one pending card; nothing is arranged before a person approves it. The operator reads the card, decides, and the agent carries the decision on.
6. **The person's share of the work** is the card and the one call only a person can make. That is the 5–10 minutes in the table.

Models: DeepSeek v4 pro for the agent and the call reasoning; v4.1 flash for the simulated counterparts, briefs and reply suggestions; Claude Haiku as the drivability classifier and photo reader; ElevenLabs for speech out and Voxtral for speech in, all through OpenRouter.

---

## Assumptions and sources

- **Measured, AI cost:** `usage.cost_usd`, as billed by OpenRouter, summed per case over the 241 agent runs in the sandbox database (`cr_agent_runs`, DeepSeek v4 pro) from the night harness passes of 24–25 October, the dossier-first design included: 44 incident cases (median $0.14, mean $0.22, max $0.73 for a driver who refused to stop; one 18-run soak case at $1.22 left out) and 19 routine questions (driver and site, $0.001–0.05). Per run: a driver turn $0.028 in 27 s, an operator turn $0.060 in 79 s, a site turn $0.011. The monthly figure uses the mean ($0.22 per incident, $0.015 per routine question). The earlier figure from the 18 traced runs under `starter/traces/e2e-roles-2026-10-25T01-24/` (mean €0.12) still holds as the median.
- **Measured, agent time:** each run's start to finish on the wall clock in `cr_agent_runs` (averages above). A case of 3–6 runs takes 1–3 minutes of agent work spread over the conversation.
- **Cross-check:** the night of testing cost about $7.2 (OpenRouter key went from $2.88 to $10.08, PROCESS.md) over ~70–120 story runs plus calls and checks. That is $0.06–0.10 per story, an upper bound because tests repeat work.
- **Model prices:** the traces were billed at full provider rates (about $1.3–1.9 per million input tokens). OpenRouter lists v4 pro at $0.21–1.91/M input and $0.42–3.83/M output across providers, the cheapest at a discount, so cost per case could drop several times. Sources: [v4 pro](https://openrouter.ai/deepseek/deepseek-v4-pro), [v4 flash](https://openrouter.ai/deepseek/deepseek-v4-flash), [v4 pro endpoint prices](https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-pro/endpoints).
- **Calls:** a full delivery run on 25 October (one position-check call plus the reasoning around it) cost $0.021 of text models, the call itself $0.0067; its speech was 1,127 characters of ElevenLabs at ~$0.03 per 1,000 characters, about $0.034, so roughly $0.055 (€0.05) per call with speech. Speech in through OpenRouter (Voxtral) is a fraction of a cent per call. An earlier 3-call run cost $0.105 of text models. Telephony is not included.
- **Hosting (assumed):** €50–150 a month for one small VM (Next.js app, dossier and call service, the phone line) and a small managed Postgres. No GPU: speech in and out run through OpenRouter. €100 used.
- **Volume:** 25,000 cars a year (brief) ≈ 2,100 a month. Assumed: 15% of deliveries (10–20%) need incident handling, there is one routine question (driver, desk or customer) per delivery, and 1 in 3 routine questions needs a card. In the traces, C needed a card and D and G were closed by the agent.
- **Handling times (assumed):** today an incident takes 30–45 min (read, look up the order, call the driver, find a tow, workshop or ferry, call the dealer, update the driver, write notes, chase) and a routine question 5–10 min. With Road Desk an incident takes 5–10 min and a routine card 1–2 min.
- **Employer costs 2026:** TyEL employer average 17.10%, health insurance 1.91%, unemployment 0.31% (1.23% above €2.5M payroll), accident 0.51%, group life 0.06% ([ETK](https://www.etk.fi/wp-content/uploads/2026/01/lakisaateiset-sosiaalivakuutusmaksut-suomessa-2026-suomi-1.pdf), [Statistics Finland](https://media.stat.fi/A7H6ohk0S8qafyCM4bfDaz/cmnrl8pep1mb807w1rc26gpmx)). Paid leave: 1,635 worked hours out of 1,950 paid (25 holiday days, 9 public holidays, 8 sick days), plus a holiday bonus of 50% of holiday pay.
- **Shift premiums:** Sunday work +100% ([Working Hours Act 872/2019](https://www.finlex.fi/fi/lainsaadanto/2019/872)). Evenings +15% and nights +30% are assumed (typical collective-agreement levels), which averages +25% over a 24/7 week. A 24/7 seat is 8,760 h ÷ 1,635 h ≈ 5.4 FTE.
- **Exchange rate:** ECB reference rate on 23 Oct 2026, 1 EUR = 1.1193 USD ([ECB](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html)).
