import assert from "node:assert/strict"
import { test } from "node:test"
import { completeTranscript, transcriptHolds } from "./transcript-merge"

const phone = [{ t: 2.8, role: "model", text: "Road Desk here. First: are you safe, and is this urgent?" }, { t: 9.1, role: "user", text: "Yes, I'm safe. Where do I leave the keys?" }]
const captions = [
  { role: "model" as const, text: "Road Desk here. First: are you safe, and is this urgent?", t: 2.8 },
  { role: "user" as const, text: "Yes, I'm safe. Where do I leave the keys?", t: 9.1 },
  { role: "model" as const, text: "Leave them with Elena Fallowwick at the desk. That's all I needed, thanks.", t: 15.2 },
]

test("a transcript missing the last caption is noticed", () => {
  assert.equal(transcriptHolds(phone, captions), false)
  assert.equal(transcriptHolds([...phone, { t: 15.2, role: "model", text: "Leave them with Elena Fallowwick at the desk. That's all I needed, thanks." }], captions), true)
})

test("captions split differently from the phone's lines still count as held", () => {
  const split = [...phone, { t: 15.2, role: "model", text: "Leave them with Elena Fallowwick at the desk." }, { t: 17.0, role: "model", text: "That's all I needed, thanks." }]
  assert.equal(transcriptHolds(split, captions), true)
})

test("the missing last turn is appended in time order, with epoch captions rebased on the call start", () => {
  const merged = completeTranscript(phone, captions, null)
  assert.equal(merged.length, 3)
  assert.equal(merged[2].text, "Leave them with Elena Fallowwick at the desk. That's all I needed, thanks.")
  const epoch = completeTranscript(phone, [{ role: "user", text: "See you Monday, take care.", t: 1792923800.5 }], 1792923777.5)
  assert.equal(epoch.at(-1)?.t, 23)
  assert.equal(epoch.at(-1)?.role, "user")
})

test("a complete transcript is returned untouched", () => {
  assert.deepEqual(completeTranscript(phone, captions.slice(0, 2), null), phone)
})
