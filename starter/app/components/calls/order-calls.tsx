"use client"

import { useState } from "react"
import type { OrderCallView } from "@/lib/present/order-calls"
import { personColor } from "@/lib/present/color"
import { fmtDateTime } from "@/lib/present/time"
import { Icon } from "../icons"
import { Chip, Empty, SectionHead } from "../ui"
import "./calls.css"

/**
 * The order's calls as the call service holds them: a demo run's calls, the autopilot's calls and live calls it has
 * read. Each row is the call's one-line outcome; opening it shows the recorded turns and what the call established.
 * Times are in the delivery place's zone like the rest of the page; a call stamped ahead of the simulated clock says so.
 */
export function OrderCalls({ calls, simNow, zone }: { calls: OrderCallView[]; simNow: string | null; zone: string | null }) {
  if (!calls.length) return null
  const ahead = calls.filter((call) => call.aheadOfClock).length
  return <section className="sec" id="calls">
    <SectionHead title="Calls" count={calls.length} note={ahead ? `${ahead} from a simulated delivery run, ahead of the clock` : undefined} />
    {!simNow && <Empty>Times are the call service&apos;s.</Empty>}
    <div className="rows">{calls.map((call) => <CallRow key={call.id} call={call} zone={zone} />)}</div>
  </section>
}

function CallRow({ call, zone }: { call: OrderCallView; zone: string | null }) {
  const [open, setOpen] = useState(() => typeof window !== "undefined" && window.location.hash === `#${call.id}`)
  const turns = call.turns ?? []
  return <article className={`row thread${open ? " open" : ""}`} id={call.id}>
    <div className="row-main">
      <button type="button" className="thread-head" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <div className="row-title"><Icon name="phone" size={13} /> {call.title} <Chip tone={call.tone}>{call.verdict ? `review ${call.verdict.toLowerCase()}` : call.escalated ? "handed to an operator" : call.missing?.length ? `${call.missing.length} open` : "complete"}</Chip></div>
        <div className="row-sub">
          {call.source}{call.fromLine ? " · from the Road Desk line" : ""}{call.aheadOfClock ? " · simulated delivery run, ahead of the clock" : ""}{call.detail ? ` · ${call.detail}` : ""}
        </div>
        {!open && turns[0] && <div className="row-preview"><b>{turns[0].speaker}:</b> {turns[0].text}</div>}
      </button>
      {open && <div className="chat">
        {turns.map((turn, index) => {
          const ours = turn.speaker === "Road Desk"
          const previous = turns[index - 1]
          return <div key={index} className={`chat-line chat-${ours ? "ours" : "theirs"}`} style={{ "--who": ours ? "var(--teal-ink)" : personColor(turn.speaker) } as React.CSSProperties}>
            {(!previous || previous.speaker !== turn.speaker) && <div className="chat-who"><b>{turn.speaker}</b></div>}
            <div className="chat-bubble"><p className="msg-body">{turn.text}</p></div>
            <time className="chat-when" dateTime={turn.at}>{fmtDateTime(turn.at, zone, false)}</time>
          </div>
        })}
        {!turns.length && <p className="empty">The call has no recorded turns.</p>}
        {call.slots && call.slots.length > 0 && <ul className="call-claims">
          {call.slots.map((slot, index) => <li key={index}><b>{slot.label}:</b> {slot.value} <small>turn {slot.turn}: “{slot.quote}”</small></li>)}
        </ul>}
        {call.missing && call.missing.length > 0 && <p className="call-missing">Not established: {call.missing.join(", ")}.</p>}
        {call.escalated && <p className="call-missing">Handed to an operator: {call.escalated}</p>}
      </div>}
      <div className="thread-tools">
        <button type="button" className="show-more" onClick={() => setOpen((value) => !value)}>{open ? "Hide the call" : `Open the call (${turns.length} turn${turns.length === 1 ? "" : "s"})`}</button>
      </div>
    </div>
    <div className="row-side">{fmtDateTime(call.at, zone, false)}</div>
  </article>
}
