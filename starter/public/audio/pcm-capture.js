// Mic capture for the in-app call screen: any context rate -> 24 kHz mono PCM16,
// 20 ms (480 sample) frames posted to the main thread. Box-filter resampling with
// fractional edges, the same method as the phone's own capture worklet.
// The gate, as a fraction of full scale: speech at a normal distance is 0.03 to 0.2; fan and keyboard noise 0.002 to 0.01.
const GATE_RMS = 0.015
// Frames kept open after the last loud frame (20 ms each): 300 ms, so a trailing consonant is not cut.
const GATE_HOLD_FRAMES = 15

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / 24000
    this.acc = 0
    this.fill = 0
    this.out = new Int16Array(480)
    this.n = 0
    this.hold = 0
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0]
    if (!input) return true
    for (let i = 0; i < input.length; i++) {
      let weight = 1
      const value = input[i]
      while (weight > 1e-9) {
        const take = Math.min(weight, this.ratio - this.fill)
        this.acc += value * take
        this.fill += take
        weight -= take
        if (this.fill >= this.ratio - 1e-9) {
          const sample = Math.max(-1, Math.min(1, this.acc / this.ratio))
          this.out[this.n++] = sample < 0 ? sample * 32768 : sample * 32767
          this.acc = 0
          this.fill = 0
          if (this.n === 480) {
            // Noise gate: a frame below the gate (room hum, keyboard, breath) goes out as silence, so the line's own
            // end-of-speech detection is not kept open by background noise; a short hold keeps word endings intact.
            let energy = 0
            for (let k = 0; k < 480; k++) energy += this.out[k] * this.out[k]
            const rms = Math.sqrt(energy / 480) / 32768
            if (rms >= GATE_RMS) this.hold = GATE_HOLD_FRAMES
            else if (this.hold > 0) this.hold -= 1
            else this.out.fill(0)
            this.port.postMessage(this.out.buffer, [this.out.buffer])
            this.out = new Int16Array(480)
            this.n = 0
          }
        }
      }
    }
    return true
  }
}
registerProcessor("pcm-capture", PcmCapture)
