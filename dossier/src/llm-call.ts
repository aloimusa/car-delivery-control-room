// A simulated call where BOTH sides are the model, grounded in the dossier:
//   caller  = Mira, running on the model-composed card (the same text the voice line gets), one or two sentences a turn;
//   callee  = the persona (desk or driver), answering only from a fact sheet built from the dossier plus the scenario's twist;
//   then a typed extraction pass turns the transcript into slots that cite turns, and triage for inbound calls.
// Output is the same CallRecord the scripted runner produces, so the UI and the dossier do not care which ran.
import { z } from "zod"
import type { Dossier } from "./dossier"
import { CHECKLISTS, CallRecord, MAX_QUESTIONS, SlotName, SlotValue, Situation, Urgency, type CallBrief } from "./live"
import type { Persona } from "./sim/personas"
import { composeBrief, renderDossier } from "./reason"
import { items } from "./brief"
import { EMERGENCY_CLOSING, closingKind, contextPrompt, isClosing } from "./context"

type Usage = { prompt_tokens: number; completion_tokens: number; cost?: number }
async function complete(apiKey: string, model: string, messages: { role: "system" | "user" | "assistant"; content: string }[], json = false, temperature = 0.6): Promise<{ text: string; cost: number }> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "x-title": "road-dossier sim call" },
    // Spoken turns: no hidden reasoning (it eats the small budget and returns empty text); extraction: JSON mode with room to think.
    body: JSON.stringify({ model, temperature, max_tokens: json ? 2500 : 300, usage: { include: true }, ...(json ? { response_format: { type: "json_object" } } : { reasoning: { enabled: false } }), messages }),
  })
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const body = (await res.json()) as { choices: { message: { content: string } }[]; usage?: Usage }
  return { text: (body.choices[0]?.message.content ?? "").trim(), cost: body.usage?.cost ?? 0 }
}

/** What the callee knows: the dossier's view of their side plus the scenario twist from the persona's scripted answers. */
function calleeSheet(d: Dossier, persona: Persona): string {
  const order = items(d, "orders")[0]!.record
  const site = items(d, "sites").map((i) => i.record).find((s) => s.id === order.pickup_site_id)
  const veh = items(d, "vehicles")[0]?.record
  const facts = Object.values(persona.answers).map((a) => a.text)
  const role = persona.role === "PICKUP_SITE_DESK"
    ? `You are the person at the reception desk of ${site?.name ?? "a car dealership"}. A delivery company calls about collecting a car (${veh ? `${veh.make} ${veh.model}` : "a car"}, their reference ${order.reference}).`
    : `You are ${persona.answers.DRIVER_START_LOCATION ? "a freelance delivery driver" : "the driver"} ${items(d, "drivers")[0]?.record.display_name ?? ""} working for a car delivery company. The support line calls you, or you call them.`
  return [role, `Your mood: ${persona.mood.toLowerCase()}.`, "What you know and will say if asked (never invent beyond this; if you do not know, say so):", ...facts.map((f) => `- ${f}`),
    ...(persona.volunteers ?? []).map((v) => `- You may volunteer: ${v}`),
    "Answer in one or two natural spoken sentences. Do not list facts you were not asked about. Do not use markdown."].join("\n")
}

/**
 * The other party's next line on a live call, from the same persona sheet a simulated call uses: Mira is on the phone
 * line, the party is played here. `history` is the call so far from the party's point of view (caller = Mira).
 */
export async function personaTurn(d: Dossier, persona: Persona, purpose: CallBrief["purpose"], history: { role: "caller" | "callee"; text: string }[], opts: { apiKey?: string; brief?: CallBrief } = {}): Promise<{ text: string; costUsd: number; end: boolean }> {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY; if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set")
  const inbound = purpose === "DRIVER_INBOUND"
  const said = history.filter((h) => h.role === "callee").length
  // The scripted first words: the greeting on an outbound call, the reason for calling on an inbound one.
  if (said === 0 && !inbound) return { text: persona.greeting, costUsd: 0, end: false }
  if (said === 0 && inbound && persona.inbound) return { text: persona.inbound.opening, costUsd: 0, end: false }
  // Mira's closing line ends the call: the party says goodbye once and the screen hangs up, instead of the two models
  // wishing each other goodbye until someone presses the button.
  const lastCaller = [...history].reverse().find((h) => h.role === "caller")?.text ?? ""
  const end = !!opts.brief && said > 0 && isClosing(lastCaller, opts.brief)
  const system = calleeSheet(d, persona) + (inbound && persona.inbound ? `\nYou called the support line because: ${persona.inbound.opening}` : "")
    + (end ? "\nThey are ending the call now. Say goodbye in one short sentence; ask nothing and add no new facts." : "")
  // Mira speaks sentence by sentence and each arrives as its own line; the model wants them as one turn.
  const messages: { role: "user" | "assistant"; content: string }[] = []
  for (const h of history) {
    const role = h.role === "caller" ? "user" as const : "assistant" as const
    const last = messages[messages.length - 1]
    if (last && last.role === role) last.content = `${last.content} ${h.text}`.trim(); else messages.push({ role, content: h.text })
  }
  if (!messages.length || messages[messages.length - 1]!.role === "assistant") messages.push({ role: "user", content: "(They are waiting for you to speak.)" })
  const r = await complete(apiKey, process.env.CALLEE_MODEL ?? "deepseek/deepseek-v4.1-flash", [{ role: "system", content: system }, ...messages], false, 0.7)
  return { text: (r.text.split("\n")[0] ?? "").trim() || (end ? "Thanks, goodbye." : "Sorry, say that again?"), costUsd: r.cost, end }
}

/** The callee saying they are at the wheel right now; "pulled over" or "parked" in the same breath means they are not. */
const DRIVING = /\b(i'?m|i am|still|am|while|and) driving\b|\bbehind the wheel\b|\bon the road right now\b|\bmake it quick\b/i
const STOPPED = /\b(pulled (over|in|into|off)|parked|stopped|stationary|lay-by|rest area|service area|off the road|not driving|terminal|boarding lane)\b/i

const Extraction = z.object({
  triage: z.object({ urgency: Urgency, situation: Situation, turnSeq: z.number().int().nonnegative(), quote: z.string() }).strict().nullable(),
  slots: z.array(z.object({ slot: SlotName, value: z.union([z.string(), z.boolean()]), turnSeq: z.number().int().nonnegative(), quote: z.string() }).strict()).max(16),
  escalate: z.boolean(),
}).strict()

export async function runLlmCall(d: Dossier, persona: Persona, purpose: CallBrief["purpose"], startedAt: string, opts: { model?: string; apiKey?: string } = {}): Promise<{ record: CallRecord; costUsd: number; briefBy: "MODEL" | "RULE"; extractionError: string | null }> {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY; if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set")
  const model = opts.model ?? process.env.REASON_MODEL ?? "deepseek/deepseek-v4-pro"
  const composed = await composeBrief(d, purpose, { model, apiKey }); let cost = composed.costUsd ?? 0
  const brief = composed.brief
  const inbound = purpose === "DRIVER_INBOUND"
  // Mira speaks from the same prompt the live line gets: the brief and the whole dossier.
  const callerSys = contextPrompt(d, brief) + "\n\nYou are on a live call now. Speak only your next line, one to three sentences, no stage directions, no speaker label."
  const calleeSys = calleeSheet(d, persona) + (inbound && persona.inbound ? `\nYou called the support line. Your first words after they answer are: "${persona.inbound.opening}"` : "")
  const turns: CallRecord["turns"] = []; let seq = 0, clock = Date.parse(startedAt)
  const say = (speaker: "CALLER" | "CALLEE", text: string) => { const dur = 1200 + text.length * 55; turns.push({ seq, speaker, startedAt: new Date(clock).toISOString(), endedAt: new Date(clock + dur).toISOString(), text, audioKey: null }); clock += dur + 400; return seq++ }
  const history: { role: "system" | "user" | "assistant"; content: string }[] = []   // from the caller's point of view: assistant = caller
  const asCallee = () => history.map((m) => (m.role === "system" ? m : { role: m.role === "assistant" ? "user" as const : "assistant" as const, content: m.content }))
  // opening
  if (inbound) { say("CALLEE", persona.greeting); history.push({ role: "user", content: persona.greeting }) }
  else { say("CALLEE", persona.greeting); history.push({ role: "user", content: persona.greeting }) }
  const maxTurns = inbound ? 2 + 2 * (MAX_QUESTIONS[persona.inbound?.urgency ?? "ROUTINE"] + 2) : 2 + 2 * (brief.ask.length + 2)
  let done = false
  const minTurnsBeforeClose = inbound ? 3 : Math.max(3, brief.ask.length - 1)
  say("CALLER", brief.opening); history.push({ role: "assistant", content: brief.opening })
  const calleeModel = process.env.CALLEE_MODEL ?? "deepseek/deepseek-v4.1-flash"     // the persona needs no depth; the fast model halves the wall time
  { const r0 = await complete(apiKey, calleeModel, [{ role: "system", content: calleeSys }, ...asCallee()], false, 0.7); cost += r0.cost; const reply0 = r0.text.split("\n")[0]!.trim(); if (reply0) { say("CALLEE", reply0); history.push({ role: "user", content: reply0 }) } }
  // The same sentence twice, or the emergency instruction twice, ends the call: a person would stop talking and let them act.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim()
  const saidBefore = new Set<string>()
  let saidEmergency = 0
  // A driver who says they are driving gets one short question and a close, whatever the brief still wants asked:
  // the prompt says so, and this counts the caller's turns since they said it so a third one becomes the closing.
  let drivingSince: number | null = null
  const isDriving = (reply: string) => DRIVING.test(reply) && !STOPPED.test(reply)
  if (persona.role === "DRIVER" && turns.some((t) => t.speaker === "CALLEE" && isDriving(t.text))) drivingSince = 0
  for (let i = 0; i < maxTurns && !done; i++) {
    const turnsWhileDriving = drivingSince === null ? 0 : i - drivingSince
    const guard = drivingSince !== null
      ? (turnsWhileDriving === 0 ? "\n(They are driving: ask at most one short question now, or offer to call back once they have stopped. Never ask them to look anything up.)"
        : "\n(They are driving and you have asked your one question: ask nothing more. Offer to call back or ask them to pull over somewhere safe and write in the app, read back in one sentence, and end with the closing sentence now.)")
      : i < minTurnsBeforeClose ? "\n(You have not asked everything yet: do not close the call on this turn; ask your next question.)" : ""
    const c = await complete(apiKey, model, [{ role: "system", content: callerSys + guard }, ...history], false, 0.5); cost += c.cost
    let line = c.text.replace(/^Mira:\s*/i, "").split("\n")[0]!.trim(); if (!line) break
    const key = norm(line)
    if (/\b112\b/.test(line)) saidEmergency += 1
    if (saidEmergency >= 2 && !isClosing(line, brief)) { line = EMERGENCY_CLOSING }
    else if (saidBefore.has(key) && i >= 1 && !isClosing(line, brief)) { line = /\b112\b/.test(line) ? EMERGENCY_CLOSING : brief.closing }
    // One question and one read-back are all a driving driver gets; a third turn that still is not the closing becomes it.
    else if (drivingSince !== null && turnsWhileDriving >= 2 && !isClosing(line, brief)) { line = brief.closing }
    saidBefore.add(key)
    say("CALLER", line); history.push({ role: "assistant", content: line })
    // The closing line ends the call: no further callee turn, never a second closing. A hand-off that is not the
    // closing sentence ("an operator will call you back", "goodbye") ends the call too, but the closing is still spoken.
    const kind = closingKind(line, brief)
    if (kind === "handoff") {
      if (!norm(brief.closing).includes(key)) { say("CALLER", brief.closing); history.push({ role: "assistant", content: brief.closing }) }
      done = true; break
    }
    if (kind) { done = true; break }
    const r = await complete(apiKey, calleeModel, [{ role: "system", content: calleeSys }, ...asCallee()], false, 0.7); cost += r.cost
    const reply = r.text.split("\n")[0]!.trim(); if (!reply) break
    say("CALLEE", reply); history.push({ role: "user", content: reply })
    if (persona.role === "DRIVER" && drivingSince === null && isDriving(reply)) drivingSince = i + 1
  }
  if (!done) { say("CALLER", brief.closing) }
  const ex = await extractTurns(apiKey, model, brief, turns, inbound, persona.role === "DRIVER" ? "Driver" : "Desk", startedAt); cost += ex.cost
  const extracted = ex.extracted
  const slots = ex.slots
  const missing = (inbound ? (extracted?.triage ? CHECKLISTS[extracted.triage.situation] : []) : brief.ask).filter((k) => !slots.some((x) => x.value.slot === k))
  const outcome: CallRecord["outcome"] = inbound ? (extracted?.escalate ? "ESCALATED" : "COMPLETED") : missing.length ? "PARTIAL" : "COMPLETED"
  const toolCalls: CallRecord["toolCalls"] = extracted?.escalate && inbound ? [{ turnSeq: Math.max(0, seq - 2), name: "ESCALATE_TO_OPERATOR", argument: `${extracted.triage?.urgency ?? ""} ${extracted.triage?.situation ?? ""}: ${slots.map((s) => `${s.value.slot}=${JSON.stringify(s.value.value)}`).join(", ")}` }] : []
  const record = CallRecord.parse({
    // The id carries the whole wall clock: two runs placing the same call at the same simulated minute keep both records
    // (four trailing digits of it came round every 28 minutes, and a re-run overwrote the earlier record).
    id: `call-llm-${persona.id}-${Date.parse(startedAt).toString(36)}-${Date.now().toString(36)}`, orderId: brief.orderId, brief, direction: inbound ? "INBOUND" : "OUTBOUND", attempt: 1,
    startedAt, endedAt: new Date(clock).toISOString(), outcome, engine: "SIMULATED_LLM", triage: extracted?.triage ?? null, toolCalls, turns, slots, toneReview: null,
    retryAfter: outcome === "PARTIAL" ? new Date(clock + 2 * 3600e3).toISOString() : null,
  })
  return { record, costUsd: cost, briefBy: composed.by, extractionError: ex.error }
}

export async function extractTurns(apiKey: string, model: string, brief: CallBrief, turns: CallRecord["turns"], inbound: boolean, calleeLabel: string, startedAt: string): Promise<{ extracted: z.infer<typeof Extraction> | null; slots: CallRecord["slots"]; cost: number; error: string | null }> {
  let cost = 0
  // The day the call is about, for times said without a date: the collection date in the brief, else the call date.
  const aboutDate = brief.mayState.join(" ").match(/\b(\d{1,2}) (October|November|December|January|February|March|April|May|June|July|August|September)\b/)
    ? (() => { const m = brief.mayState.join(" ").match(/\b(\d{1,2}) (October|November|December|January|February|March|April|May|June|July|August|September)\b/)!; const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].indexOf(m[2]!) + 1; return `${startedAt.slice(0, 4)}-${String(month).padStart(2, "0")}-${m[1]!.padStart(2, "0")}` })()
    : startedAt.slice(0, 10)
  const transcript = turns.map((t) => `${t.seq} ${t.speaker === "CALLER" ? "Mira" : calleeLabel}: ${t.text}`).join("\n")
  const want = inbound ? Array.from(new Set([...Object.values(CHECKLISTS).flat()])) : brief.ask
  const exSys = `You extract facts from a phone transcript into JSON. Extract a slot when the callee (${calleeLabel}) states it directly, including clear negatives and plain paraphrases: "reception doesn't have the keys" is KEYS_AT_SITE=false; "stock control will hand it over" is RELEASE_CONTACT_NAME="stock control"; "we open at eight thirty" with a slot at nine is OPEN_DURING_SLOT=true. Uncertainty is not a value: "I can't see it from here" is NOT VEHICLE_PRESENT=false. DRIVER_SAFE is about danger, not about being parked: a driver who is driving along and says everything is fine is DRIVER_SAFE=true; DRIVER_SAFE=false only when they say they are in danger, hurt, stuck, or that the situation is not safe. "No" to "are you off the road?" is not DRIVER_SAFE=false. When the callee corrects themselves ("the car is here... actually it went out, so no") the corrected, later statement is the value: record it once, citing that turn. Never fill a slot the callee did not address. Each slot cites the turn number and quotes the exact words. Boolean slots are true/false; ETA is an ISO 8601 UTC instant: a time said without a date is on the day the call is about (${aboutDate} when the brief is about a collection or arrival on that day, "tomorrow" means the day after the call date ${startedAt.slice(0, 10)}), and a local time is converted from the callee's zone; an ETA is always after the call started (${startedAt}), so a clock time that would fall earlier is on the following day; "nothing else", "all good", "no" to the anything-else question is ISSUE_REPORTED="none"; WARNING_LIGHT is one of NONE, AMBER_STEADY, AMBER_FLASHING, RED; text slots are short. Slots allowed: ${want.join(", ")}. ${inbound ? "This is an inbound driver call: also classify triage {urgency: EMERGENCY|URGENT|ROUTINE, situation: WARNING_LIGHT|BREAKDOWN|ACCIDENT|DELAY|KEYS_ACCESS|EXPENSE|OTHER_QUESTION, turnSeq, quote} from the driver's first substantive turn, and set escalate true if a person must act." : "triage is null; escalate true only if the callee reported something that blocks the collection."} Answer JSON: {"triage": ..., "slots": [{"slot","value","turnSeq","quote"}], "escalate": boolean}`
  let extracted: z.infer<typeof Extraction> | null = null, feedback = ""
  for (let attempt = 0; attempt < 2 && !extracted; attempt++) {
    const e = await complete(apiKey, model, [{ role: "system", content: exSys }, { role: "user", content: transcript + (feedback ? `\n\nPrevious answer rejected: ${feedback}` : "") }], true, 0); cost += e.cost
    try { const parsed = Extraction.safeParse(JSON.parse(e.text.replace(/^```(?:json)?\s*|```\s*$/g, ""))); if (parsed.success) extracted = parsed.data; else feedback = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") } catch (err) { feedback = "not valid JSON" }
  }
  // A call whose extraction failed twice has no claims and used to say nothing about why: the reason goes to the log
  // and to the caller, so "0 claims" can be told from "the callee said nothing".
  const error = extracted ? null : `extraction failed twice: ${feedback || "no answer"}`
  if (error) console.warn(`[llm-call] ${brief.id}: ${error}`)
  const slots: CallRecord["slots"] = []
  for (const s of extracted?.slots ?? []) {
    const v = SlotValue.safeParse({ slot: s.slot, value: s.value }); if (!v.success) continue
    if (!turns[s.turnSeq] || turns[s.turnSeq]!.speaker !== "CALLEE") continue
    if (slots.some((x) => x.value.slot === s.slot)) continue
    slots.push({ value: v.data, turnSeq: s.turnSeq, quote: s.quote.slice(0, 300) })
  }
  return { extracted, slots, cost, error }
}

/** A live phone-line call (VoiceChat): turns from the phone's transcript of record -> typed claims, same CallRecord shape. */
export async function ingestTranscript(d: Dossier, purpose: CallBrief["purpose"], rawTurns: { speaker: string; text: string; startedAt?: string; endedAt?: string }[], opts: { startedAt?: string | undefined; endedAt?: string | undefined; engine?: string | undefined; lineCallId?: string | undefined; model?: string; apiKey?: string; brief?: CallBrief | undefined } = {}): Promise<{ record: CallRecord; costUsd: number }> {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY; if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set")
  const model = opts.model ?? process.env.REASON_MODEL ?? "deepseek/deepseek-v4-pro"
  // The brief the line's model held, when the caller knows it; composing a fresh one would review the call against a card Mira never saw.
  const composed = opts.brief ? { brief: opts.brief, costUsd: 0 } : await composeBrief(d, purpose, { model, apiKey }); let cost = composed.costUsd ?? 0
  const brief = composed.brief
  const inbound = purpose === "DRIVER_INBOUND"
  const startedAt = opts.startedAt ?? rawTurns[0]?.startedAt ?? new Date().toISOString()
  let clock = Date.parse(startedAt)
  const turns: CallRecord["turns"] = rawTurns.filter((t) => t.text && t.text.trim()).map((t, i) => {
    const speaker: "CALLER" | "CALLEE" = /^(caller|model|agent|mira)$/i.test(t.speaker) ? "CALLER" : "CALLEE"
    const s = t.startedAt ? Date.parse(t.startedAt) : clock; const e = t.endedAt ? Date.parse(t.endedAt) : s + 1200 + t.text.length * 55; clock = e + 400
    return { seq: i, speaker, startedAt: new Date(s).toISOString(), endedAt: new Date(e).toISOString(), text: t.text.trim(), audioKey: null }
  })
  if (!turns.length) throw new Error("no spoken turns")
  const ex = await extractTurns(apiKey, model, brief, turns, inbound, brief.callee.kind === "DRIVER" ? "Driver" : "Desk", startedAt); cost += ex.cost
  const missing = (inbound ? (ex.extracted?.triage ? CHECKLISTS[ex.extracted.triage.situation] : []) : brief.ask).filter((k) => !ex.slots.some((x) => x.value.slot === k))
  const outcome: CallRecord["outcome"] = inbound ? (ex.extracted?.escalate ? "ESCALATED" : "COMPLETED") : missing.length ? "PARTIAL" : "COMPLETED"
  const engine = (["VOICECHAT_11B", "PERSONAPLEX", "CHAINED_STT_LLM_TTS"].includes(opts.engine ?? "") ? opts.engine : "VOICECHAT_11B") as CallRecord["engine"]
  const record = CallRecord.parse({
    id: `call-line-${(opts.lineCallId ?? Date.parse(startedAt).toString(36)).replace(/[^a-z0-9-]/gi, "")}`, orderId: brief.orderId, brief, direction: inbound ? "INBOUND" : "OUTBOUND", attempt: 1,
    startedAt, endedAt: opts.endedAt ?? new Date(clock).toISOString(), outcome, engine, triage: ex.extracted?.triage ?? null,
    toolCalls: ex.extracted?.escalate && inbound ? [{ turnSeq: Math.max(0, turns.length - 1), name: "ESCALATE_TO_OPERATOR", argument: `${ex.extracted.triage?.urgency ?? ""} ${ex.extracted.triage?.situation ?? ""}` }] : [],
    turns, slots: ex.slots, toneReview: null, retryAfter: outcome === "PARTIAL" ? new Date(clock + 2 * 3600e3).toISOString() : null,
  })
  return { record, costUsd: cost }
}
