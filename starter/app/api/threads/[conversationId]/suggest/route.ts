import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { HelpdeskError, suggestFor } from "@/lib/present/helpdesk"
import { loadOrder } from "@/lib/present/load"
import { buildRecordView } from "@/lib/present/record"
import { conversations } from "@/lib/schema"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Drafts for a conversation, from the dossier of the order the conversation is filed on: {orderId?, intent?}.
 * A thread can be shown on a related order's page; the drafts still read the thread's own order, because that is the
 * order the other party is writing about. `orderId` (the page's order) is only a fallback when the thread row has none.
 */
export async function POST(request: Request, context: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await context.params
  const input = (await request.json().catch(() => ({}))) as { orderId?: unknown; intent?: unknown }
  const [row] = await db.select({ orderId: conversations.orderId }).from(conversations).where(eq(conversations.id, conversationId)).limit(1)
  const orderId = row?.orderId ?? (typeof input.orderId === "string" ? input.orderId : null)
  if (!orderId) return NextResponse.json({ error: "No such conversation." }, { status: 404 })
  const loaded = await loadOrder(orderId)
  if (!loaded) return NextResponse.json({ error: "No such order." }, { status: 404 })
  const view = buildRecordView(loaded.bundle)
  const thread = view.threads.find((item) => item.id === conversationId)
  if (!thread) return NextResponse.json({ error: "No such conversation on this order." }, { status: 404 })
  const pageOrder = typeof input.orderId === "string" ? input.orderId : null
  try {
    const result = await suggestFor(view.header.reference, thread, { intent: typeof input.intent === "string" && input.intent.trim() ? input.intent.trim().slice(0, 600) : undefined })
    // Which order the drafts were read from, so the composer can say so when it is not the page's order.
    return NextResponse.json({ ...result, order: { id: loaded.order.id, reference: view.header.reference }, filedElsewhere: !!pageOrder && pageOrder !== loaded.order.id && pageOrder.toUpperCase() !== view.header.reference })
  } catch (error) {
    if (error instanceof HelpdeskError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("helpdesk suggest", error)
    return NextResponse.json({ error: "No drafts right now." }, { status: 500 })
  }
}
