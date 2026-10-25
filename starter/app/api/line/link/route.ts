import { NextResponse } from "next/server"
import { activeDriverId, driverName, loadOrderFacts } from "@/lib/agent/context"
import { appendEvent, resolveOrder } from "@/lib/cr/queries"
import type { CallRecord, CallReview } from "@/lib/present/call-types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BASE = process.env.CALL_SERVICE_URL ?? "http://127.0.0.1:8799"
const INGESTIBLE = new Set(["PICKUP_READINESS", "DRIVER_INBOUND", "DRIVER_START_CHECK", "POSITION_CHECK"])

type Line = { t: number; role: string; text: string }
type LinkBody = {
  orderRef?: unknown; callId?: unknown; purpose?: unknown; who?: unknown; duration?: unknown
  /** Epoch seconds from the phone's record. */
  started?: unknown; ended?: unknown
  /** The phone contact that placed the call; always roaddesk, the turn-based line. */
  caller?: unknown
  /** The phone's recording of the call (…/line/api/calls/<id>/audio/mix.wav, same origin as the page), for the call service to cut per turn. */
  audioUrl?: unknown
  transcript?: Line[]
}

/**
 * After a live call on the Road Desk line: hands the phone's transcript to the call
 * service for extraction (claims citing turns, and a review for outbound
 * calls), then links the call to its order, so the call, its claims and its
 * review show in the order's node panel. Extraction failing does not stop the
 * link: the transcript is kept either way.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as LinkBody | null
  if (typeof body?.orderRef !== "string" || typeof body.callId !== "string") return NextResponse.json({ error: "orderRef and callId are required" }, { status: 400 })
  const order = await resolveOrder(body.orderRef)
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 })
  const purpose = typeof body.purpose === "string" ? body.purpose : "CALL"
  const inbound = purpose === "DRIVER_INBOUND"
  // The screen names who is on the far end of the line from where the user sits. On an inbound call the user is the
  // driver and the far end is Road Desk, so the record names the driver instead: the call is with them, not with us.
  let who = typeof body.who === "string" ? body.who : "the other party"
  if (inbound) {
    const facts = await loadOrderFacts(order.id).catch(() => null)
    const driverId = facts ? activeDriverId(facts) : null
    who = (driverId ? await driverName(driverId).catch(() => null) : null) ?? "the driver"
  }
  const seconds = typeof body.duration === "number" ? Math.round(body.duration) : null
  const transcript = Array.isArray(body.transcript) ? body.transcript.filter((line) => typeof line?.text === "string").slice(0, 400) : []
  const startedMs = typeof body.started === "number" ? body.started * 1000 : Date.now() - (seconds ?? 0) * 1000
  const endedMs = typeof body.ended === "number" ? body.ended * 1000 : startedMs + (seconds ?? 0) * 1000

  // Only the line's own recording of this call, over https or on this box.
  const audioUrl = typeof body.audioUrl === "string" && /^(https:\/\/[^/]+|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)\/line\/api\/calls\/[a-z0-9-]+\/audio\/mix\.wav$/i.test(body.audioUrl) && body.audioUrl.includes(`/calls/${body.callId}/`) ? body.audioUrl : null

  let ingested: { call: CallRecord; review: CallReview | null } | null = null
  let ingestError: string | null = null
  if (INGESTIBLE.has(purpose) && transcript.length) {
    try {
      const response = await fetch(`${BASE}/calls/ingest`, {
        method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({
          ref: order.reference, purpose, engine: "CHAINED_STT_LLM_TTS", lineCallId: body.callId, audioUrl,
          startedAt: new Date(startedMs).toISOString(), endedAt: new Date(endedMs).toISOString(),
          // The phone's model is Mira; the user is whoever answered.
          turns: transcript.map((line) => ({ speaker: line.role === "model" ? "model" : "user", text: line.text, startedAt: new Date(startedMs + line.t * 1000).toISOString() })),
        }),
      })
      const text = await response.text()
      if (response.ok) {
        const record = JSON.parse(text) as CallRecord & { review?: CallReview | null }
        const { review, ...call } = record
        ingested = { call: call as CallRecord, review: review ?? null }
      } else ingestError = text.slice(0, 200) || `The call service answered ${response.status}.`
    } catch {
      ingestError = "The call service did not answer."
    }
  }

  const event = await appendEvent({
    caseId: null, orderId: order.id, actorType: "system", actorId: "roaddesk-line",
    kind: "note", channel: purpose === "DRIVER_INBOUND" ? "driver_voice" : "system",
    body: inbound
      ? `${who} called the Road Desk line${seconds != null ? `, ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : ""}. Recorded on the phone line.`
      : `Live call on the Road Desk line with ${who}${seconds != null ? `, ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : ""}. Recorded on the phone line.`,
    data: {
      line_call_id: body.callId, purpose, who, direction: inbound ? "INBOUND" : "OUTBOUND", duration_s: seconds, transcript, caller: "roaddesk",
      ingested_call_id: ingested?.call.id ?? null, review: ingested?.review ?? null,
    },
  })
  return NextResponse.json({ ok: true, eventId: event.id, ingested, ingestError })
}
