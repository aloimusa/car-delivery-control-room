// The phone line's own recording of a live call, cut per turn, so a call made on the line can be heard the way a
// simulated one can. The phone keeps mix.wav: PCM16 at 24 kHz, left channel the party (the line's "user"), right
// channel Mira. A turn's slice is its own channel between its start and the next speaker's start; a run of Mira's
// sentences shares its stretch by text length, because the line stamps her sentences when they are queued, not when
// they are heard. Files land under data/out/audio/<callId>/<seq>.wav like the rendered mp3s.
import { mkdirSync, writeFileSync } from "node:fs"
import type { CallRecord } from "./live"

/** Only the line's recording, over https or on this box: the url comes from the browser. */
export function lineAudioUrlOk(url: string, lineCallId: string): boolean {
  try {
    const u = new URL(url)
    const local = u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost")
    return (u.protocol === "https:" || local) && u.pathname.endsWith(`/api/calls/${lineCallId}/audio/mix.wav`)
  } catch { return false }
}

function parseWav(buf: Buffer): { channels: number; rate: number; data: Buffer } | null {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null
  let at = 12, channels = 0, rate = 0, bits = 0
  while (at + 8 <= buf.length) {
    const id = buf.toString("ascii", at, at + 4), size = buf.readUInt32LE(at + 4)
    if (id === "fmt ") { channels = buf.readUInt16LE(at + 10); rate = buf.readUInt32LE(at + 12); bits = buf.readUInt16LE(at + 22) }
    if (id === "data") { if (bits !== 16 || !channels) return null; return { channels, rate, data: buf.subarray(at + 8, Math.min(buf.length, at + 8 + size)) } }
    at += 8 + size + (size % 2)
  }
  return null
}

function wavMono(samples: Int16Array, rate: number): Buffer {
  const head = Buffer.alloc(44)
  head.write("RIFF", 0); head.writeUInt32LE(36 + samples.length * 2, 4); head.write("WAVE", 8)
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22)
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34)
  head.write("data", 36); head.writeUInt32LE(samples.length * 2, 40)
  return Buffer.concat([head, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)])
}

/** Fetches the recording and writes one wav per turn; returns the call with audioKeys set, or unchanged with the reason. */
export async function attachLineAudio(call: CallRecord, audioUrl: string, audioRoot: URL): Promise<{ call: CallRecord; sliced: number; failed: string | null }> {
  let wav: ReturnType<typeof parseWav>
  try {
    const res = await fetch(audioUrl, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return { call, sliced: 0, failed: `recording ${res.status}` }
    wav = parseWav(Buffer.from(await res.arrayBuffer()))
  } catch (e) { return { call, sliced: 0, failed: `recording: ${(e as Error).message.slice(0, 120)}` } }
  if (!wav) return { call, sliced: 0, failed: "recording is not PCM16 wav" }
  const { channels, rate, data } = wav
  const frames = Math.floor(data.length / 2 / channels)
  const t0 = Date.parse(call.startedAt)
  const at = (iso: string) => Math.max(0, Math.min(frames, Math.round((Date.parse(iso) - t0) / 1000 * rate)))
  // Runs of one speaker: the run owns the stretch up to the next speaker's first turn (or the end of the recording).
  const runs: { turns: CallRecord["turns"]; from: number; to: number }[] = []
  for (const turn of call.turns) {
    const last = runs[runs.length - 1]
    if (last && last.turns[0]!.speaker === turn.speaker) last.turns.push(turn)
    else { if (last) last.to = at(turn.startedAt); runs.push({ turns: [turn], from: at(turn.startedAt), to: frames }) }
  }
  const dir = new URL(`${call.id}/`, audioRoot)
  mkdirSync(dir, { recursive: true })
  const byId = new Map<number, string>()
  let sliced = 0
  for (const run of runs) {
    const channel = channels === 1 ? 0 : run.turns[0]!.speaker === "CALLER" ? 1 : 0
    const chars = run.turns.reduce((n, t) => n + Math.max(1, t.text.length), 0)
    let from = run.from
    for (const [index, turn] of run.turns.entries()) {
      const share = index === run.turns.length - 1 ? run.to : from + Math.round((run.to - run.from) * Math.max(1, turn.text.length) / chars)
      const to = Math.max(from, Math.min(run.to, share))
      if (to - from < rate / 10) { from = to; continue }   // under 100 ms: nothing to hear
      const mono = new Int16Array(to - from)
      for (let i = 0; i < mono.length; i++) mono[i] = data.readInt16LE(((from + i) * channels + channel) * 2)
      writeFileSync(new URL(`${turn.seq}.wav`, dir), wavMono(mono, rate))
      byId.set(turn.seq, `${call.id}/${turn.seq}.wav`); sliced++
      from = to
    }
  }
  return { call: { ...call, turns: call.turns.map((t) => ({ ...t, audioKey: t.audioKey ?? byId.get(t.seq) ?? null })) }, sliced, failed: null }
}
