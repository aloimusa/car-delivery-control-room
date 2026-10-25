import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BASE = process.env.CALL_SERVICE_URL ?? "http://127.0.0.1:8799"

/** The other party's next line on a live call, played by the model from the order's persona: text and its voice. */
export async function POST(request: Request) {
  const body = await request.text()
  try {
    const response = await fetch(`${BASE}/calls/persona-turn`, { method: "POST", headers: { "content-type": "application/json" }, body, cache: "no-store", signal: AbortSignal.timeout(40_000) })
    return new NextResponse(await response.text(), { status: response.status, headers: { "content-type": "application/json" } })
  } catch (error) {
    return NextResponse.json({ error: `The call service did not answer: ${error instanceof Error ? error.message : "error"}` }, { status: 502 })
  }
}
