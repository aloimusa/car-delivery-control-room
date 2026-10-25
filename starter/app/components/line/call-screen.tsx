"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Icon } from "../icons"
import { personColor } from "@/lib/present/color"
import { ClaimsList } from "../calls/review-parts"
import type { CallRecord, CallReview } from "@/lib/present/call-types"
import "./call-screen.css"

// A live call inside Road Desk. Only the voice backend is shared with the phone
// server, reached same-origin under /line/ (Caddy adds the auth). One contact
// places every call: roaddesk, the turn-based line (local Whisper in, a model
// holding the whole order dossier, ElevenLabs out; 1.5 to 3 s to each reply).
// Audio both ways is PCM16 mono at 24 kHz in 20 ms frames.

const LINE = "/line/api"
const CALLER = "roaddesk"
const CALLER_WORDS = "Road Desk line"
const FRAME_BYTES = 960
const SILENCE = new ArrayBuffer(FRAME_BYTES)
const QUIET_MS = 5000
// When the model answers for the party: it speaks once Mira's turn is over, which is her text complete (the line's
// turn_end marker), her audio drained on this side, and this much quiet. Without a turn_end (an error on the line, an
// older phone server) the longer wait stands in for it, so a pause between two of her sentences is not taken for her
// turn's end.
const SETTLE_MS = 700
const SETTLE_NO_TURN_END_MS = 2500
// The party's goodbye ends the call: after Mira's reply to it, or in any case after this long.
const CLOSE_AFTER_MS = 8000

type Phase = "idle" | "checking" | "composing" | "connecting" | "live" | "ending" | "ended" | "failed"
/** Whose turn it is, so a pause before a reply reads as thinking rather than a dropped line. */
type Turn = "listening" | "thinking" | "speaking"
type Caption = { role: "model" | "user"; text: string; final: boolean; t: number }
type Line = { t: number; role: string; text: string }
/** The party's next line from the call service: words, voice, and whether it was a goodbye. */
type PersonaTurn = { text: string; audio: string | null; end: boolean }

export type CallTarget = {
  /** Order reference, e.g. CD-420584. */
  orderRef: string
  /** Card purpose on the call service: DRIVER_INBOUND, PICKUP_READINESS, POSITION_CHECK… */
  purpose: string
  /** Who is on the other end of the line from where you sit: "Road Desk", "Mira from Bahn". */
  calleeName: string
  /** What you play: "You are Leo Quellford, the driver." */
  youAre: string
  /** The call in words: "Pickup readiness", "Driver calls in". */
  purposeLabel: string
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
}

/** The call card: name and purpose, timer, live captions, Mute, Hang up; after hang-up the phone's transcript, linked to the order. */
export type LiveResult = { call: CallRecord; review: CallReview | null }

export function CallScreen({ target, onClose, autoStart = false, onResult }: {
  target: CallTarget; onClose: () => void; autoStart?: boolean
  /** Told the extracted claims and review once the call service has read the transcript. */
  onResult?: (result: LiveResult | null) => void
}) {
  const [phase, setPhase] = useState<Phase>("idle")
  const [status, setStatus] = useState("")
  const [captions, setCaptions] = useState<Caption[]>([])
  const [muted, setMuted] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [, setTick] = useState(0)
  const [transcript, setTranscript] = useState<Line[] | null>(null)
  const [linked, setLinked] = useState<string | null>(null)
  const [result, setResult] = useState<LiveResult | null>(null)
  const [turn, setTurn] = useState<Turn>("listening")
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const call = useRef<{
    id: string; ws: WebSocket | null; wsPath: string; ctx: AudioContext; stream: MediaStream | null; node: AudioWorkletNode | null
    nextT: number; sources: AudioBufferSourceNode[]; lastMsg: number; reconnected: boolean; heartbeat: number; ended: boolean
  } | null>(null)
  // Auto-answer: the model plays the other party on the live line. Its lines are spoken into the call as if from the
  // microphone (the line hears them like any caller), and the microphone stays silent while it is on.
  const [auto, setAuto] = useState(false)
  const flags = useRef({ muted: false, live: false, auto: false, speaking: false })
  // The party's turn-taking: Mira's turn complete (turnEnded), her audio heard since (gotAudio), the reply fetched while
  // she is still speaking (prefetch), a trigger that arrived while a reply was under way (pending), and the goodbye (closing).
  const as = useRef({ turnEnded: false, gotAudio: false, armedAt: 0, quietSince: 0, poller: 0, prefetch: null as Promise<PersonaTurn> | null, busy: false, pending: false, closing: false, closeTimer: 0, retries: 0 })
  flags.current.muted = muted
  flags.current.auto = auto
  const captionsEnd = useRef<HTMLDivElement>(null)

  useEffect(() => { captionsEnd.current?.scrollIntoView({ block: "end" }) }, [captions])
  useEffect(() => {
    if (phase !== "live") return
    const timer = setInterval(() => {
      setTick((value) => value + 1)
      // Audio still queued means the other side is speaking, whatever the markers last said.
      const current = call.current
      if (current && current.nextT > current.ctx.currentTime + 0.05) setTurn("speaking")
      else setTurn((value) => value === "speaking" ? "listening" : value)
    }, 250)
    return () => clearInterval(timer)
  }, [phase])

  const stopPlayback = () => {
    const current = call.current
    if (!current) return
    for (const source of current.sources) { try { source.stop() } catch { /* already stopped */ } }
    current.sources = []
    current.nextT = 0
  }

  const play = (buffer: ArrayBuffer) => {
    const current = call.current
    if (!current) return
    const pcm = new Int16Array(buffer)
    if (!pcm.length) return
    const samples = new Float32Array(pcm.length)
    for (let index = 0; index < pcm.length; index++) samples[index] = pcm[index] / 32768
    const audio = current.ctx.createBuffer(1, samples.length, 24000)
    audio.copyToChannel(samples, 0)
    const source = current.ctx.createBufferSource()
    source.buffer = audio
    source.connect(current.ctx.destination)
    as.current.gotAudio = true
    // Gapless: schedule back to back about 100 ms ahead; resync after an underrun.
    const now = current.ctx.currentTime
    if (current.nextT < now + 0.02) current.nextT = now + 0.1
    source.start(current.nextT)
    current.nextT += audio.duration
    current.sources.push(source)
    source.onended = () => { if (call.current) call.current.sources = call.current.sources.filter((item) => item !== source) }
  }

  // Captions as the phone shows them: the caller's interim text replaces itself until final; the model's words join
  // one caption until a 1.5 s pause in its own text, whatever the caller says meanwhile.
  const lines = useRef<{ items: Caption[]; model: number | null; user: number | null; modelT: number }>({ items: [], model: null, user: null, modelT: 0 })
  const caption = (role: "model" | "user", text: string, final: boolean, t: number) => {
    const state = lines.current
    if (role === "user") {
      const index = state.user
      if (index != null && state.items[index] && !state.items[index].final) state.items[index] = { ...state.items[index], text, final }
      else { state.items.push({ role, text, final, t }); state.user = state.items.length - 1 }
    } else {
      const index = state.model
      if (index != null && state.items[index] && !state.items[index].final && t - state.modelT < 1.5) state.items[index] = { ...state.items[index], text: `${state.items[index].text}${text}`.trimStart(), final, t }
      else { state.items.push({ role, text: text.trim(), final, t }); state.model = state.items.length - 1 }
      state.modelT = t
    }
    setCaptions([...state.items])
  }

  const cleanup = () => {
    const current = call.current
    if (!current) return
    clearInterval(current.heartbeat)
    disarm()
    if (as.current.closeTimer) { window.clearTimeout(as.current.closeTimer); as.current.closeTimer = 0 }
    stopPlayback()
    try { if (current.ws) { current.ws.onclose = null; current.ws.close() } } catch { /* closing */ }
    try { current.stream?.getTracks().forEach((track) => track.stop()) } catch { /* stopped */ }
    try { void current.ctx.close() } catch { /* closed */ }
    flags.current.live = false
  }

  const finish = useCallback(async (failed: boolean) => {
    const current = call.current
    if (!current || current.ended) return
    current.ended = true
    cleanup()
    if (failed) return
    setPhase("ending")
    setStatus("Fetching the phone's record of the call…")
    // The phone finalises the call (audio and transcript) shortly after hang-up.
    let record: { started?: number; ended?: number | null; duration?: number; transcript?: Line[] } | null = null
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const response = await fetch(`${LINE}/calls/${encodeURIComponent(current.id)}`, { cache: "no-store" })
        if (response.ok) { record = await response.json(); if (record?.ended) break }
      } catch { /* retry */ }
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
    setTranscript(record?.transcript ?? [])
    setPhase("ended")
    setStatus(record?.ended ? `Call ended, ${clock(record.duration ?? 0)}` : "Call ended. The phone has not finished its record yet.")
    // The call service reads the transcript for claims (and a review for outbound calls); then the call is linked to the order.
    setExtracting(true)
    try {
      const response = await fetch("/api/line/link", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderRef: target.orderRef, callId: current.id, purpose: target.purpose, who: target.calleeName, duration: record?.duration ?? null,
          started: record?.started ?? null, ended: record?.ended ?? null, transcript: record?.transcript ?? [], caller: CALLER,
          // The phone's recording, so the call service can cut it per turn and the call can be heard on the order.
          audioUrl: new URL(`${LINE}/calls/${encodeURIComponent(current.id)}/audio/mix.wav`, window.location.href).href }),
      })
      const linkedBody = (await response.json().catch(() => null)) as { ingested?: LiveResult | null; ingestError?: string | null } | null
      if (response.ok) setLinked(target.orderRef)
      setResult(linkedBody?.ingested ?? null)
      setExtractError(linkedBody?.ingestError ?? null)
      onResult?.(linkedBody?.ingested ?? null)
    } catch { /* the call is still on the phone line */ }
    setExtracting(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  // One reconnect to the same call; after that the call is lost.
  const lost = (path: string) => {
    const current = call.current
    if (!current || current.ended) return
    if (!current.reconnected) { current.reconnected = true; setStatus("Connection lost, reconnecting…"); setTimeout(() => openRef.current?.(path), 500) }
    else { setPhase("failed"); setStatus("The connection to the line was lost."); void finish(true) }
  }
  const openRef = useRef<((path: string) => void) | null>(null)

  const openSocket = useCallback((path: string) => {
    const current = call.current
    if (!current) return
    const url = new URL(`/line/${path}`, window.location.href)
    url.protocol = url.protocol.replace("http", "ws")
    const ws = new WebSocket(url)
    ws.binaryType = "arraybuffer"
    current.ws = ws
    current.lastMsg = Date.now()
    ws.onmessage = (event) => {
      current.lastMsg = Date.now()
      if (typeof event.data !== "string") { play(event.data as ArrayBuffer); return }
      const message = JSON.parse(event.data) as { type: string; state?: string; message?: string; role?: string; text?: string; final?: boolean; kind?: string; t?: number }
      if (message.type === "pong") return
      if (message.type === "state") {
        if (message.state === "connecting") { setPhase("connecting"); setStatus(message.message || "Connecting…") }
        if (message.state === "live") { setPhase("live"); flags.current.live = true; setStartedAt((value) => value ?? Date.now()); setStatus("") }
        if (message.state === "failed") { setPhase("failed"); setStatus(message.message || "The call failed."); void finish(true) }
        if (message.state === "ended") void finish(false)
      } else if (message.type === "marker") {
        if (message.kind === "user_speech_start") setTurn("listening")
        if (message.kind === "user_speech_stop") setTurn("thinking")
        if (message.kind === "model_speech_start" || message.kind === "agent_bos") { setTurn("speaking"); as.current.quietSince = 0 }
        // Mira speaks sentence by sentence. turn_end says her text is complete: the party's reply is fetched now, while
        // her last sentences still play, and spoken once her audio has drained here. A stop without a turn_end only
        // arms the longer wait, so she is never answered between two of her sentences.
        if (message.kind === "turn_end") {
          as.current.turnEnded = true
          if (flags.current.auto && !as.current.closing && !as.current.busy && !as.current.prefetch) as.current.prefetch = fetchPersonaRef.current?.() ?? null
          arm()
        }
        if (message.kind === "model_speech_stop" || message.kind === "agent_eos") { setTurn("listening"); arm() }
        if (message.kind === "barge_in") { stopPlayback(); setTurn("listening") }
        // The line could not take its turn: the party speaks again after the long wait rather than both sides waiting forever.
        if (message.kind === "error") { setStatus(`The line reported an error${typeof (message as unknown as { where?: unknown }).where === "string" ? ` (${(message as unknown as { where: string }).where})` : ""}.`); arm() }
      }
      if (message.type === "text" && message.text) {
        if (message.role === "user" && flags.current.auto) return
        if (message.role === "user" && message.final) setTurn((value) => value === "speaking" ? value : "thinking")
        caption(message.role === "model" ? "model" : "user", message.text, !!message.final, message.t ?? Date.now() / 1000)
      }
    }
    ws.onclose = () => {
      if (call.current !== current || current.ended || current.ws !== ws) return
      current.ws = null
      lost(path)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finish])
  openRef.current = openSocket

  const start = useCallback(async () => {
    setPhase("checking")
    setStatus("Checking the line…")
    setCaptions([])
    lines.current = { items: [], model: null, user: null, modelT: 0 }
    setTranscript(null)
    setLinked(null)
    // The AudioContext must be created inside the tap.
    const ctx = new AudioContext()
    void ctx.resume()
    try {
      const book = await fetch(`${LINE}/phonebook`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null) as { busy?: unknown; contacts?: { id: string; status: string; detail?: string }[] } | null
      if (!book) throw new Error("The phone line is not reachable.")
      // `busy` names a call on a contact that has the GPU to itself; the Road Desk line runs on OpenRouter end to end
      // and takes any number of calls at once, so it is not refused here.
      const contact = book.contacts?.find((item) => item.id === CALLER)
      if (!contact) throw new Error(`The ${CALLER_WORDS} is not on the phone yet.`)
      if (contact.status !== "awake") setStatus(`The ${CALLER_WORDS} is asleep; waking it takes a little while…`)
      if (!navigator.mediaDevices) throw new Error("This page cannot use the microphone (it needs https).")
      await ctx.audioWorklet.addModule("/audio/pcm-capture.js")
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
      // The line's system prompt: the model-composed brief plus the whole dossier (/context/…), fetched by the phone
      // server from the call service. Composing takes 5 to 10 s the first time, so it is warmed before the call is placed,
      // which also stops here when the agent may not make this call at all.
      const cardUrl = `http://127.0.0.1:8799/context/${target.orderRef}/${target.purpose}?by=model`
      setPhase("composing")
      setStatus("Composing Mira's brief…")
      const began = Date.now()
      const ticker = window.setInterval(() => setStatus(`Composing Mira's brief… ${Math.round((Date.now() - began) / 1000)} s`), 1000)
      const warm = await fetch(`/api/line/warm?ref=${encodeURIComponent(target.orderRef)}&purpose=${encodeURIComponent(target.purpose)}`, { cache: "no-store" })
      const warmed = await warm.json().catch(() => null) as { ok?: boolean; error?: string } | null
      window.clearInterval(ticker)
      if (!warm.ok || !warmed?.ok) { stream.getTracks().forEach((track) => track.stop()); throw new Error(warmed?.error ? `No call: ${warmed.error}.` : "Mira's brief could not be composed.") }
      setStatus("Connecting…")
      const response = await fetch(`${LINE}/calls`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ caller_id: CALLER, card_url: cardUrl }) })
      if (!response.ok) { stream.getTracks().forEach((track) => track.stop()); throw new Error(`The line refused the call (${response.status}).`) }
      const placed = (await response.json()) as { call_id: string; ws: string; name?: string }
      const node = new AudioWorkletNode(ctx, "pcm-capture")
      ctx.createMediaStreamSource(stream).connect(node)
      call.current = { id: placed.call_id, ws: null, wsPath: placed.ws, ctx, stream, node, nextT: 0, sources: [], lastMsg: Date.now(), reconnected: false, heartbeat: 0, ended: false }
      // Mic frames go out continuously; silence when muted, or while the model speaks in half-duplex.
      node.port.onmessage = (event) => {
        const current = call.current
        if (!current?.ws || current.ws.readyState !== 1 || !flags.current.live) return
        const modelSpeaking = current.nextT > current.ctx.currentTime
        // While the model answers for the party, its own frames carry the timeline: the microphone's frames would
        // interleave with them and the line would hear chopped speech. Between its lines, silence keeps the clock.
        if (flags.current.auto) { if (!flags.current.speaking) current.ws.send(SILENCE); return }
        current.ws.send(flags.current.muted ? SILENCE : event.data as ArrayBuffer)
      }
      call.current.heartbeat = window.setInterval(() => {
        const current = call.current
        if (!current?.ws || current.ws.readyState !== 1) return
        try { current.ws.send(JSON.stringify({ type: "ping" })) } catch { /* closing */ }
        // No message for 5 s: treat the socket as lost and reconnect once.
        if (Date.now() - current.lastMsg > QUIET_MS) {
          const ws = current.ws
          current.ws = null
          ws.onclose = null
          try { ws.close() } catch { /* closing */ }
          lost(current.wsPath)
        }
      }, 2000)
      setPhase("connecting")
      openSocket(placed.ws)
    } catch (error) {
      try { void ctx.close() } catch { /* closed */ }
      setPhase("failed")
      setStatus(error instanceof Error ? (error.name === "NotAllowedError" ? "The microphone was not allowed. Allow it in the browser and try again." : error.message) : "The call could not start.")
    }
  }, [target, openSocket, finish])

  const hangUp = useCallback(async () => {
    const current = call.current
    if (!current) { onClose(); return }
    try { if (current.ws?.readyState === 1) current.ws.send(JSON.stringify({ type: "hangup" })) } catch { /* closing */ }
    try { await fetch(`${LINE}/calls/${encodeURIComponent(current.id)}/hangup`, { method: "POST" }) } catch { /* the phone ends it anyway */ }
    void finish(false)
  }, [finish, onClose])

  // Leaving the screen mid-call hangs up, so the line is never left holding a call nobody hears.
  useEffect(() => () => {
    const current = call.current
    if (current && !current.ended) {
      try { if (current.ws?.readyState === 1) current.ws.send(JSON.stringify({ type: "hangup" })) } catch { /* closing */ }
      void fetch(`${LINE}/calls/${encodeURIComponent(current.id)}/hangup`, { method: "POST" }).catch(() => undefined)
      current.ended = true
      cleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** The party's reply, spoken into the live call: text from the persona, voice from the call service, frames to the line. */
  const autoRef = useRef<(() => Promise<void>) | null>(null)
  const hangRef = useRef<(() => Promise<void>) | null>(null)
  const fetchPersonaRef = useRef<(() => Promise<PersonaTurn>) | null>(null)
  const disarm = () => { if (as.current.poller) { window.clearInterval(as.current.poller); as.current.poller = 0 } }
  // Waits for Mira's audio to drain here, then the settle, then lets the party speak (or hangs up after its goodbye).
  const arm = () => {
    const state = as.current
    if (!flags.current.auto || !flags.current.live || state.poller) return
    state.armedAt = Date.now(); state.quietSince = 0
    state.poller = window.setInterval(() => {
      const current = call.current
      if (!current || current.ended || !flags.current.auto) { disarm(); return }
      const draining = current.nextT > current.ctx.currentTime + 0.05
      // The opening's turn_end arrives before its first frame: wait for audio, or four seconds for a turn with none.
      const heard = state.gotAudio || Date.now() - state.armedAt > 4000
      if (draining || flags.current.speaking || !heard) { state.quietSince = 0; return }
      if (!state.quietSince) { state.quietSince = Date.now(); return }
      if (Date.now() - state.quietSince < (state.turnEnded ? SETTLE_MS : SETTLE_NO_TURN_END_MS)) return
      disarm()
      if (state.closing) { void hangRef.current?.(); return }
      void autoRef.current?.()
    }, 100)
  }
  const speakAsParty = useCallback(async (text: string, mp3: string | null) => {
    const current = call.current
    if (!current || current.ended || !current.ws || current.ws.readyState !== 1) return
    caption("user", text, true, Date.now() / 1000)
    if (!mp3) return
    const bytes = Uint8Array.from(atob(mp3), (c) => c.charCodeAt(0))
    const decoded = await current.ctx.decodeAudioData(bytes.buffer.slice(0))
    // Resample to the line's 24 kHz mono, then PCM16 in 20 ms frames, paced like a microphone.
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 24000), 24000)
    const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start()
    const mono = (await offline.startRendering()).getChannelData(0)
    // The voice pauses 600 to 900 ms between sentences, longer than the line's end-of-turn silence (500 ms), so one
    // reply arrived as two turns and the second cut Mira off mid-answer. Any quiet stretch is shortened to 250 ms.
    const quietLevel = 0.01, quietMax = 24000 / 4
    const pcm = new Int16Array(mono.length)
    let length = 0, quiet = 0
    for (let i = 0; i < mono.length; i++) {
      const v = Math.max(-1, Math.min(1, mono[i]!))
      if (Math.abs(v) < quietLevel) { quiet += 1; if (quiet > quietMax) continue } else quiet = 0
      pcm[length++] = v < 0 ? v * 0x8000 : v * 0x7fff
    }
    // Heard on this side too, so the operator follows both voices: the same samples the line hears.
    const heard = current.ctx.createBuffer(1, Math.max(1, length), 24000)
    const channel = heard.getChannelData(0)
    for (let i = 0; i < length; i++) channel[i] = pcm[i]! / 32768
    const local = current.ctx.createBufferSource(); local.buffer = heard; local.connect(current.ctx.destination); local.start()
    flags.current.speaking = true
    const samplesPerFrame = FRAME_BYTES / 2
    const began = performance.now()
    await new Promise<void>((resolve) => {
      let index = 0
      const tick = () => {
        const ws = call.current?.ws
        // Switching to the microphone mid-sentence stops the party's frames at once, before the mic's interleave with them.
        if (!ws || ws.readyState !== 1 || call.current?.ended || !flags.current.auto || index * samplesPerFrame >= length) { try { local.stop() } catch { /* done */ } resolve(); return }
        // Send every frame whose time has come; silence padding on the last one.
        const due = Math.floor((performance.now() - began) / 20)
        while (index <= due && index * samplesPerFrame < length) {
          const frame = new Int16Array(samplesPerFrame)
          frame.set(pcm.subarray(index * samplesPerFrame, Math.min(length, (index + 1) * samplesPerFrame)))
          ws.send(frame.buffer)
          index += 1
        }
        setTimeout(tick, 20)
      }
      tick()
    })
    flags.current.speaking = false
  }, [])
  /** The party's next line from the call service, for the call so far as the captions have it (Mira's sentences, the party's lines). */
  const fetchPersona = useCallback(async (): Promise<PersonaTurn> => {
    const history = lines.current.items.filter((item) => item.final).map((item) => ({ role: item.role === "model" ? "caller" as const : "callee" as const, text: item.text }))
    const response = await fetch("/api/calls/persona-turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ref: target.orderRef, purpose: target.purpose, history }) })
    const turn = await response.json() as { text?: string; audio?: string | null; end?: boolean; error?: string }
    if (!response.ok || !turn.text) throw new Error(turn.error ?? "No reply from the persona.")
    return { text: turn.text, audio: turn.audio ?? null, end: !!turn.end }
  }, [target.orderRef, target.purpose])
  fetchPersonaRef.current = fetchPersona
  const autoReply = useCallback(async () => {
    const state = as.current
    if (!flags.current.auto || !flags.current.live) return
    // A trigger while a reply is under way is kept, not dropped: dropping it was a stall with nobody speaking.
    if (state.busy || flags.current.speaking) { state.pending = true; return }
    state.busy = true
    try {
      const turn = await (state.prefetch ?? fetchPersona())
      state.prefetch = null
      if (!flags.current.auto || !flags.current.live) return
      state.turnEnded = false; state.gotAudio = false; state.retries = 0
      await speakAsParty(turn.text, turn.audio)
      if (turn.end) {
        // The party has said goodbye: the call ends once Mira has answered it, or after a moment in any case.
        state.closing = true
        setStatus("Ending the call…")
        state.closeTimer = window.setTimeout(() => { void hangRef.current?.() }, CLOSE_AFTER_MS)
      }
    } catch (error) {
      state.prefetch = null
      setStatus(error instanceof Error ? error.message : "The model could not answer for the other party.")
      if (state.retries++ < 2) window.setTimeout(arm, 2000)
    } finally {
      state.busy = false
      if (state.pending) { state.pending = false; arm() }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPersona, speakAsParty])
  autoRef.current = autoReply
  hangRef.current = hangUp
  // Switched to the model mid-call while Mira waits for an answer: it answers now. Switched to the microphone: nothing queued speaks.
  useEffect(() => {
    if (!flags.current.live) return
    if (auto) arm()
    else { disarm(); as.current.prefetch = null; as.current.pending = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto])

  const autoStarted = useRef(false)
  useEffect(() => { if (autoStart && !autoStarted.current) { autoStarted.current = true; void start() } }, [autoStart, start])

  const inCall = phase === "checking" || phase === "composing" || phase === "connecting" || phase === "live"
  return <div className={`call-screen cs-${phase}`} aria-live="polite">
    <div className="cs-sim"><i aria-hidden="true" />Simulated call · nothing is dialled</div>
    <header className="cs-head">
      <span className="cs-avatar" aria-hidden="true" style={{ background: personColor(target.calleeName), color: "#fff" }}>{target.calleeName.split(/\s+/).filter((part) => /^[A-Z]/.test(part)).map((part) => part[0]).join("").slice(0, 2)}</span>
      <b>{target.calleeName}</b>
      <span className="cs-purpose">{target.purposeLabel} · <span className="mono">{target.orderRef}</span></span>
      <span className="cs-status">{phase === "live" && startedAt ? clock((Date.now() - startedAt) / 1000) : status || (phase === "idle" ? "Ready to call" : "")}</span>
      {phase === "live" && <span className={`cs-turn cs-turn-${turn}`} aria-live="polite"><i aria-hidden="true" />{turn === "speaking" ? `${target.calleeName.replace(/ from .*$/, "")} is speaking` : turn === "thinking" ? "Thinking…" : "Listening"}</span>}
      {phase === "live" && status && <span className="cs-note">{status}</span>}
    </header>

    {phase !== "ended" && <div className="cs-captions" aria-label="Live captions">
      {captions.length === 0 && (phase === "idle" || phase === "failed"
        ? <div className="cs-roles">
          <span><b>{target.calleeName}</b> is played by the model from the order dossier.</span>
          <span><b>{target.youAre.replace(/^You are /, "You play ")}</b></span>
          <small>Start the call to answer with your microphone, or let the model answer for you; you can switch during the call.</small>
          {phase === "failed" && status && <small>{status}</small>}
        </div>
        : <p className="cs-hint">{phase === "live" ? (auto ? "The model answers for the other party. Switch to your microphone at any time." : "Say hello. Captions appear as you both speak.") : status}</p>)}
      {captions.map((item, index) => <p key={index} className={`cs-cap cs-${item.role}${item.final ? "" : " interim"}`}>{item.text}</p>)}
      <div ref={captionsEnd} />
    </div>}

    {phase === "ended" && <div className="cs-transcript">
      <p className="cs-done">{status}{linked ? <> · added to <span className="mono">{linked}</span> on the map</> : null}</p>
      {extracting && <p className="cs-hint">Reading the transcript for claims…</p>}

      {result && <div className="cs-claims"><ClaimsList call={result.call} /></div>}
      {!extracting && !result && extractError && <p className="cs-fine">Claims could not be extracted: {extractError}</p>}
      {transcript && transcript.length > 0 ? <ol>{transcript.map((line, index) => <li key={index} className={`cs-${line.role === "model" ? "model" : "user"}`}>
        <small>{clock(line.t)}</small><span>{line.text}</span>
      </li>)}</ol> : <p className="cs-hint">The phone recorded no words for this call.</p>}
      <p className="cs-fine">Transcript of the {CALLER_WORDS}&apos;s recording. A spoken answer is a claim, not a scan or a signed record.</p>
    </div>}

    <footer className="cs-controls">
      {inCall && <>
        <button type="button" className={`cs-btn${auto ? " on" : ""}`} onClick={() => setAuto((value) => !value)} aria-pressed={auto} title="The model answers for the other party; off, your microphone does">{auto ? "Model answers" : "I answer"}</button>
        <button type="button" className={`cs-btn${muted ? " on" : ""}`} onClick={() => setMuted((value) => !value)} aria-pressed={muted} disabled={auto}>{muted ? "Unmute" : "Mute"}</button>
        <button type="button" className="cs-btn cs-hang" onClick={() => void hangUp()}><Icon name="message" size={13} />Hang up</button>
      </>}
      {(phase === "idle" || phase === "failed") && <>
        <button type="button" className="cs-btn cs-call" onClick={() => void start()} title="Mira calls; you answer with your microphone">{phase === "failed" ? "Try again" : "Start the call"}</button>
        <button type="button" className="cs-btn" onClick={() => { setAuto(true); flags.current.auto = true; void start() }} title="The same live call; the model answers for the other party">Simulate both sides</button>
        <button type="button" className="cs-btn" onClick={onClose}>Close</button>
      </>}
      {phase === "ending" && <span className="cs-hint">Saving the call…</span>}
      {phase === "ended" && <button type="button" className="cs-btn cs-call" onClick={onClose}>Done</button>}
    </footer>
  </div>
}

/** The call screen in a phone frame over the page (Demo, the action strip). */
export function CallOverlay({ target, onClose }: { target: CallTarget; onClose: () => void }) {
  return <div className="cs-overlay" role="dialog" aria-label={`Call: ${target.purposeLabel}`}>
    <div className="cs-phone"><CallScreen target={target} onClose={onClose} /></div>
  </div>
}
