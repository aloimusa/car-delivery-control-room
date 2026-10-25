// "400 orders?": a one-off look at the map at full operation. Three hundred made-up orders are drawn beside the
// dataset's hundred, driving the dataset's own routes and waiting at its own places, with the same mix of
// states: mostly routine, a few worth watching, a couple that would need a person. They exist only in this
// component's memory: no record, no page, no case, no call; a click shows a small card that says so.
import type { ChartNode, ChartRoute } from "@/lib/present/chart"

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

type LatLng = [number, number]
type Journey = { from: string; to: string; fromName: string; toName: string; parts: ChartRoute["parts"] }

/** Great-circle-ish length of a leg in kilometres, good enough to walk a route at an even pace. */
function km(a: LatLng, b: LatLng): number {
  const squeeze = Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180)
  return Math.hypot((b[0] - a[0]) * 111, (b[1] - a[1]) * 111 * squeeze)
}

function bearing(a: LatLng, b: LatLng): number {
  const squeeze = Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180)
  return (Math.atan2((b[1] - a[1]) * squeeze, b[0] - a[0]) * 180 / Math.PI + 360) % 360
}

/** The point a fraction of the way along a journey, with the direction of travel and whether that stretch is road or sea. */
function along(parts: ChartRoute["parts"], t: number): { at: LatLng; heading: number; kind: "road" | "sea" } {
  const steps: { a: LatLng; b: LatLng; kind: "road" | "sea"; length: number }[] = []
  for (const part of parts) for (let i = 1; i < part.coords.length; i++) steps.push({ a: part.coords[i - 1]!, b: part.coords[i]!, kind: part.kind, length: km(part.coords[i - 1]!, part.coords[i]!) })
  const total = steps.reduce((sum, step) => sum + step.length, 0)
  let left = total * t
  for (const step of steps) {
    if (left <= step.length || step === steps.at(-1)) {
      const f = step.length ? Math.max(0, Math.min(1, left / step.length)) : 0
      return { at: [step.a[0] + (step.b[0] - step.a[0]) * f, step.a[1] + (step.b[1] - step.a[1]) * f], heading: Math.round(bearing(step.a, step.b)), kind: step.kind }
    }
    left -= step.length
  }
  const first = parts[0]!.coords[0]!
  return { at: first, heading: 0, kind: "road" }
}

/** Journeys the crowd can drive: the dataset's own routes, each also reversed, and pairs chained where one ends where the next begins. */
function journeys(real: ChartNode[], routes: Record<string, ChartRoute>): Journey[] {
  const base: Journey[] = []
  for (const node of real) {
    const route = routes[node.orderId]
    if (node.kind !== "vessel" || !route || !route.parts.some((part) => part.coords.length > 1)) continue
    base.push({ from: node.from, to: node.to, fromName: node.fromName, toName: node.toName, parts: route.parts })
  }
  const reversed: Journey[] = base.map((j) => ({ from: j.to, to: j.from, fromName: j.toName, toName: j.fromName, parts: [...j.parts].reverse().map((part) => ({ ...part, coords: [...part.coords].reverse() })) }))
  const all = [...base, ...reversed]
  const chained: Journey[] = []
  for (const a of all) for (const b of all) {
    if (a === b || a.to !== b.from || a.from === b.to) continue
    chained.push({ from: a.from, to: b.to, fromName: a.fromName, toName: b.toName, parts: [...a.parts, ...b.parts] })
  }
  return [...all, ...chained]
}

/**
 * The crowd, derived from the real data: its moving cars sit on the dataset's own routes (also driven the other way, or two
 * routes chained where one ends where the next begins), its waiting and delivered cars at the dataset's own places. Only
 * the names, states and numbers are invented. Returns the nodes and the routes to draw under the moving ones.
 */
export function buildCrowd(real: ChartNode[], routes: Record<string, ChartRoute>, simNow: string): { nodes: ChartNode[]; routes: Record<string, ChartRoute> } {
  const r = rng(420)
  const places = real.filter((node) => node.kind === "berth")
  const anchors = places.map((node) => ({ lat: node.lat, lng: node.lng, city: node.berth?.split("|")[0] ?? node.from, name: node.fromName, kind: node.placeKind ?? "dealer" as const }))
  const roads = journeys(real, routes)
  if (!anchors.length && !roads.length) return { nodes: [], routes: {} }
  const out: ChartNode[] = []
  const tracks: Record<string, ChartRoute> = {}
  for (let i = 0; i < CROWD_SIZE; i++) {
    const n = i + 1
    const orderId = `${CROWD_PREFIX}${String(n).padStart(3, "0")}`
    const [make, models] = pick(r, MAKES)
    const vehicle = `${make} ${pick(r, models)}`
    const driver = `${pick(r, FIRST)} ${pick(r, LAST)}`
    const customer = pick(r, real).customer
    const roll = r()
    // The mix of states: about a third on the road, a third booked and waiting, the rest delivered or just ordered.
    const lane = roads.length && roll < 0.34 ? "moving" : roll < 0.66 ? "booked" : roll < 0.82 ? "delivered" : "new"
    const att = r()
    const attention: ChartNode["attention"] = att < 0.95 ? "fine" : att < 0.98 ? "watch" : lane === "moving" ? "decide" : "watch"
    const tone: ChartNode["tone"] = attention === "decide" ? "danger" : attention === "watch" ? "warn" : "neutral"
    const base = {
      orderId, reference: `CD-5${String(10000 + n * 7).slice(-5)}`, vehicle, make, customer, driver: lane === "new" ? null : driver,
      lane, laneLabel: lane === "moving" ? "Moving" : lane === "booked" ? "Booked" : lane === "delivered" ? "Delivered" : "New",
      promiseText: lane === "delivered" ? null : `${pick(r, ["Mon", "Tue", "Wed", "Thu", "Fri"])} ${pick(r, ["09:00 to 12:00", "10:00 to 16:00", "12:00 to 18:00"])}`,
      berthNote: null, trail: [] as ChartNode["trail"], ask: null,
      headline: attention === "decide" ? "The driver reports a warning light; a person decides what happens next." : attention === "watch" ? "No position from the phone for a while." : null,
      watchReason: attention === "watch" ? "phone quiet" : null,
      sig: `crowd-${n}`,
    }
    if (lane === "moving") {
      const journey = pick(r, roads)
      const t = 0.04 + r() * 0.92
      const { at, heading, kind } = along(journey.parts, t)
      const sea = kind === "sea"
      const waiting = !sea && r() < 0.15
      tracks[orderId] = { parts: journey.parts, simulated: true }
      out.push({ ...base, kind: "vessel", lat: at[0], lng: at[1], from: journey.from, to: journey.to, fromName: journey.fromName, toName: journey.toName, berth: null, heading,
        speedKmh: waiting ? 0 : sea ? 28 + Math.floor(r() * 8) : 70 + Math.floor(r() * 50), at: simNow,
        ageLabel: waiting ? "12 min ago" : "just now", stale: attention === "watch", motion: waiting ? "waiting" : "moving", motionNote: waiting ? "Stopped at a service area" : sea ? "On the ferry" : null,
        placeKind: null, placeLabel: sea ? `On the ferry towards ${journey.to}` : `On the road towards ${journey.to}`, attention, tone })
    } else {
      const a = pick(r, anchors)
      const others = anchors.filter((x) => x !== a)
      const b = others.length ? pick(r, others) : a
      const here = lane === "delivered" ? b : a
      out.push({ ...base, kind: "berth", lat: here.lat, lng: here.lng, from: a.city, to: b.city, fromName: a.name, toName: b.name, berth: `${here.city}|`, heading: null, speedKmh: null, at: null, ageLabel: null, stale: false,
        motion: null, motionNote: null, placeKind: here.kind, placeLabel: null, attention, tone })
    }
  }
  return { nodes: out, routes: tracks }
}

export function crowdCounts(crowd: ChartNode[]): { moving: number; booked: number; atPickup: number; deliveredToday: number } {
  return {
    moving: crowd.filter((node) => node.lane === "moving").length,
    booked: crowd.filter((node) => node.lane === "booked").length,
    atPickup: Math.round(crowd.filter((node) => node.lane === "booked").length * 0.18),
    deliveredToday: Math.round(crowd.filter((node) => node.lane === "delivered").length * 0.3),
  }
}
