import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BASE = process.env.CALL_SERVICE_URL ?? "http://127.0.0.1:8799"

/** Both sides of a call played by the model on the call service: {ref, purpose, twist?} -> {jobId}; poll /api/calls/jobs/:id. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { ref?: string; purpose?: string; twist?: string }
  if (!body.ref || !body.purpose) return NextResponse.json({ error: "ref and purpose are required" }, { status: 400 })
  try {
    const response = await fetch(`${BASE}/calls/sim`, {
      method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ ref: body.ref, purpose: body.purpose, twist: body.twist ?? "cooperative" }),
      signal: AbortSignal.timeout(20_000),
    })
    const text = await response.text()
    return new NextResponse(text, { status: response.status, headers: { "content-type": "application/json" } })
  } catch (error) {
    return NextResponse.json({ error: `The call service did not answer: ${error instanceof Error ? error.message : "error"}` }, { status: 502 })
  }
}
