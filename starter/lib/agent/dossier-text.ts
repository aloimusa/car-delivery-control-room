// The order's dossier as the dossier service renders it for its own model: every record graded by evidence strength,
// the live layer (cases, events, calls, telemetry) and the derived items (deadlines, silences, conflicts). It is the
// case agent's first read of a turn; the read tools stay for what it cannot carry.
const BASE = process.env.CALL_SERVICE_URL ?? "http://127.0.0.1:8799"

export async function dossierText(reference: string): Promise<{ text: string; asOf: string | null } | null> {
  try {
    const response = await fetch(`${BASE}/dossier/${encodeURIComponent(reference)}/text?live=1`, { cache: "no-store", signal: AbortSignal.timeout(6000) })
    if (!response.ok) return null
    const text = await response.text()
    return text.trim() ? { text, asOf: response.headers.get("x-as-of") } : null
  } catch {
    return null
  }
}
