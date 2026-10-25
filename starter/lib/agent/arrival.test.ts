// The gate refuses a card that says the driver arrived while its own evidence, or the latest driver-app report, still
// counts kilometres remaining (D11). No database: the facts are a minimal fixture.
import assert from "node:assert/strict"
import { test } from "node:test"
import type { OrderFacts } from "./context"
import { arrivalContradiction } from "./gate"
import type { ProposalInput } from "@/lib/cr/types"

const facts = (tracking: Record<string, unknown>[], steps: OrderFacts["steps"] = []) => ({ tracking, steps } as unknown as OrderFacts)
const card = (text: string, factText = ""): ProposalInput => ({
  title: "Call the receiver", rationale: text, action_type: "CONTACT_SITE", options: [], evidence_refs: [], assumptions: [],
  handover: { what_happened: text, facts: factText ? [{ text: factText, sources: [] }] : [], agent_did: [], unknowns: [], recommendation: "", alternatives: [] },
} as unknown as ProposalInput)

test("an arrival the card's own facts contradict is refused", () => {
  const reason = arrivalContradiction(card("Driver Freya Marvellen arrived at the delivery address.", "91 km remaining, ETA 13:24 CEST"), facts([]))
  assert.match(reason ?? "", /91 km remaining/)
  assert.match(reason ?? "", /question from the driver is not a report/)
})

test("German talking points count too", () => {
  const reason = arrivalContradiction(card("Unser Fahrer steht jetzt in der Glasbrückenweg 27.", "Noch 91 km entfernt"), facts([]))
  assert.match(reason ?? "", /steht jetzt in der/)
})

test("the latest driver-app report is the fallback evidence", () => {
  assert.match(arrivalContradiction(card("The driver has arrived at the delivery address."), facts([{ observed_at: "2026-10-21T09:00:00Z", distance_remaining_km: 91 }])) ?? "", /91 km remaining/)
  assert.equal(arrivalContradiction(card("The driver has arrived at the delivery address."), facts([{ observed_at: "2026-10-21T09:00:00Z", distance_remaining_km: 2 }])), null)
})

test("a recorded milestone or a card without an arrival claim passes", () => {
  const arrived = [{ milestone: "ARRIVED_DELIVERY", at: "2026-10-21T10:00:00Z", driverId: "d", keys: null, receiver: null, photos: 0, eventId: "e" }] as unknown as OrderFacts["steps"]
  assert.equal(arrivalContradiction(card("The driver has arrived at the delivery address.", "0 km remaining"), facts([], arrived)), null)
  assert.equal(arrivalContradiction(card("Driver asks where to leave the keys; 91 km remaining, ETA 13:24."), facts([{ distance_remaining_km: 91 }])), null)
})
