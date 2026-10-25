// The phone's transcript against the captions the call screen showed (D5). The phone marks a call ended before its
// last line is committed, so the screen waits until the transcript holds every final caption, and whatever is still
// missing after a bounded wait is appended from the captions. Pure, so it can be tested without a phone.

export type Line = { t: number; role: string; text: string }
export type SpokenCaption = { role: "model" | "user"; text: string; t: number }

const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
const isModel = (role: string) => role === "model"

function joinedByRole(lines: Line[]): Record<"model" | "user", string> {
  const of = (model: boolean) => norm(lines.filter((line) => isModel(line.role) === model).map((line) => line.text).join(" "))
  return { model: of(true), user: of(false) }
}

/** True when every final caption's words appear in the phone's lines for that side (captions and lines split differently). */
export function transcriptHolds(lines: Line[] | undefined, spoken: SpokenCaption[]): boolean {
  const joined = joinedByRole(lines ?? [])
  return spoken.every((item) => !norm(item.text) || joined[item.role].includes(norm(item.text)))
}

/**
 * The phone's lines plus the captions it never committed, in time order. `startedAt` is the call's start in epoch
 * seconds when known: the phone's `t` counts from the call start, while a caption spoken for the model-played party
 * carries epoch seconds.
 */
export function completeTranscript(lines: Line[] | undefined, spoken: SpokenCaption[], startedAt: number | null): Line[] {
  const have = lines ?? []
  if (transcriptHolds(have, spoken)) return have
  const joined = joinedByRole(have)
  const rel = (t: number) => t > 1e9 ? (startedAt != null ? Math.max(0, t - startedAt) : (have.at(-1)?.t ?? 0) + 1) : t
  const missing = spoken.filter((item) => norm(item.text) && !joined[item.role].includes(norm(item.text)))
    .map((item): Line => ({ t: rel(item.t), role: item.role, text: item.text.trim() }))
  return [...have, ...missing].sort((a, b) => a.t - b.t)
}
