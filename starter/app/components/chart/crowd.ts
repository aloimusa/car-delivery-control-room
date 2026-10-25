// "400 orders?": a one-off look at the map at full operation. Three hundred made-up orders are drawn beside the
// dataset's hundred, placed on the same corridors and at the same places as the real ones, with the same mix of
// states: mostly routine, a few worth watching, a couple that would need a person. They exist only in this
// component's memory: no record, no page, no case, no call; a click shows a small card that says so.
import type { ChartNode } from "@/lib/present/chart"

export const CROWD_SIZE = 300
export const CROWD_PREFIX = "crowd-"

const MAKES: [string, string[]][] = [
  ["Volkswagen", ["ID.4", "Golf", "Tiguan", "Passat"]], ["BMW", ["3 Series", "X3", "i4", "5 Series"]], ["Mercedes-Benz", ["C-Class", "GLC", "EQE"]],
  ["Audi", ["A4", "Q5", "e-tron GT"]], ["Volvo", ["XC60", "V60", "EX30"]], ["Toyota", ["RAV4", "Corolla", "Yaris Cross"]], ["Skoda", ["Octavia", "Enyaq", "Kodiaq"]],
  ["Kia", ["EV6", "Sportage"]], ["Peugeot", ["3008", "208"]], ["Tesla", ["Model 3", "Model Y"]], ["Porsche", ["Macan", "Taycan"]], ["Hyundai", ["Ioniq 5", "Tucson"]],
]
const FIRST = ["Jonas", "Mia", "Elias", "Aino", "Lukas", "Sofia", "Noah", "Emma", "Oskar", "Lea", "Henrik", "Ida", "Mats", "Noora", "Felix", "Clara", "Teemu", "Julia", "Anton", "Linnea"]
const LAST = ["Berg", "Lind", "Koskinen", "Müller", "Virtanen", "Schmidt", "Nielsen", "Hansen", "Weber", "Laine", "Fischer", "Mäkelä", "Jensen", "Becker", "Salo", "Wagner", "Olsen", "Hoffmann", "Heikkinen", "Larsen"]

/** A small deterministic generator, so the same toggle shows the same crowd every time. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const pick = <T,>(r: () => number, list: T[]): T => list[Math.floor(r() * list.length)]!

export function isCrowd(orderId: string | null | undefined): boolean {
  return !!orderId && orderId.startsWith(CROWD_PREFIX)
}

/** The crowd, built from the real nodes: their places and corridors are the geography; everything else is invented. */
export function buildCrowd(real: ChartNode[], simNow: string): ChartNode[] {
  const r = rng(420)
  const places = real.filter((node) => node.kind === "berth")
  const cars = real.filter((node) => node.kind === "vessel")
  const anchors = (places.length ? places : cars).map((node) => ({ lat: node.lat, lng: node.lng, city: node.berth?.split("|")[0] ?? node.from, name: node.fromName, kind: node.placeKind ?? "dealer" as const }))
  const corridors = cars.length ? cars : real
  if (!anchors.length) return []
  const out: ChartNode[] = []
  for (let i = 0; i < CROWD_SIZE; i++) {
    const n = i + 1
    const [make, models] = pick(r, MAKES)
    const vehicle = `${make} ${pick(r, models)}`
    const a = pick(r, anchors), b = pick(r, anchors.filter((x) => x !== a).length ? anchors.filter((x) => x !== a) : anchors)
    const driver = `${pick(r, FIRST)} ${pick(r, LAST)}`
    const customer = pick(r, real).customer
    const roll = r()
    // The mix of states: about a third on the road, a third booked and waiting, the rest delivered or just ordered.
    const lane = roll < 0.34 ? "moving" : roll < 0.66 ? "booked" : roll < 0.82 ? "delivered" : "new"
    const att = r()
    const attention: ChartNode["attention"] = att < 0.95 ? "fine" : att < 0.98 ? "watch" : lane === "moving" ? "decide" : "watch"
    const tone: ChartNode["tone"] = attention === "decide" ? "danger" : attention === "watch" ? "warn" : "neutral"
    const base = {
      orderId: `${CROWD_PREFIX}${String(n).padStart(3, "0")}`, reference: `CD-5${String(10000 + n * 7).slice(-5)}`, vehicle, make, customer, driver: lane === "new" ? null : driver,
      from: a.city, to: b.city, fromName: a.name, toName: b.name, lane, laneLabel: lane === "moving" ? "Moving" : lane === "booked" ? "Booked" : lane === "delivered" ? "Delivered" : "New",
      promiseText: lane === "delivered" ? null : `${pick(r, ["Mon", "Tue", "Wed", "Thu", "Fri"])} ${pick(r, ["09:00 to 12:00", "10:00 to 16:00", "12:00 to 18:00"])}`,
      berthNote: null, trail: [] as ChartNode["trail"], ask: null,
      headline: attention === "decide" ? "The driver reports a warning light; a person decides what happens next." : attention === "watch" ? "No position from the phone for a while." : null,
      watchReason: attention === "watch" ? "phone quiet" : null,
      sig: `crowd-${n}`,
    }
    if (lane === "moving") {
      // Somewhere along a real corridor, so the crowd follows the roads the fleet actually drives.
      const via = pick(r, corridors)
      const t = r()
      const lat = a.lat + (via.lat - a.lat) * t + (r() - 0.5) * 0.25
      const lng = a.lng + (via.lng - a.lng) * t + (r() - 0.5) * 0.35
      const waiting = r() < 0.15
      out.push({ ...base, kind: "vessel", lat, lng, berth: null, heading: Math.floor(r() * 360), speedKmh: waiting ? 0 : 70 + Math.floor(r() * 50), at: simNow,
        ageLabel: waiting ? "12 min ago" : "just now", stale: attention === "watch", motion: waiting ? "waiting" : "moving", motionNote: waiting ? "Stopped at a service area" : null,
        placeKind: null, placeLabel: `On the road towards ${b.city}`, attention, tone })
    } else {
      const at = lane === "delivered" ? b : a
      out.push({ ...base, kind: "berth", lat: at.lat + (r() - 0.5) * 0.02, lng: at.lng + (r() - 0.5) * 0.03, berth: `${at.city}|`, heading: null, speedKmh: null, at: null, ageLabel: null, stale: false,
        motion: null, motionNote: null, placeKind: at.kind, placeLabel: null, attention, tone })
    }
  }
  return out
}

export function crowdCounts(crowd: ChartNode[]): { moving: number; booked: number; atPickup: number; deliveredToday: number } {
  return {
    moving: crowd.filter((node) => node.lane === "moving").length,
    booked: crowd.filter((node) => node.lane === "booked").length,
    atPickup: Math.round(crowd.filter((node) => node.lane === "booked").length * 0.18),
    deliveredToday: Math.round(crowd.filter((node) => node.lane === "delivered").length * 0.3),
  }
}
