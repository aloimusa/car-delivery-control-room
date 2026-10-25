// Calls the call service holds for an order (demo-run calls, the autopilot's calls, live calls it has read), as the
// order page lists them. The map panel reads the same records; this keeps the two surfaces agreeing (D4: run calls
// showed on the map panel but never on the order page, because the page listed only the retired interviewer's calls).
import type { Bundle } from "./bundle"
import { callsFor } from "./call-service"
import { dedupeCalls } from "./call-types"
import { roboCallItem } from "./dossier"
import type { DossierItem } from "./dossier-types"
import { isBefore } from "./time"

export type OrderCallView = DossierItem & {
  /** The call service stamped this call ahead of the simulated clock: a delivery run walking the order's future, or its own wall clock. */
  aheadOfClock: boolean
  /** The call came through the Road Desk line and is also in the timeline as the line's note. */
  fromLine: boolean
  purposeCode: string | null
  calleeName: string | null
}

export async function orderCallViews(bundle: Bundle, zone: string | null): Promise<OrderCallView[]> {
  const robo = dedupeCalls(await callsFor(bundle.order.reference))
  const now = bundle.cr.now
  const lineIds = new Set(bundle.cr.events.map((event) => (event.data as Record<string, unknown>).ingested_call_id).filter((id): id is string => typeof id === "string"))
  return robo.map((call) => ({
    ...roboCallItem(call, { zone, now }),
    aheadOfClock: Boolean(call.startedAt && !isBefore(call.startedAt, now)),
    fromLine: lineIds.has(call.id),
    purposeCode: call.brief?.purpose ?? null,
    calleeName: call.brief?.callee.name ?? null,
  }))
}
