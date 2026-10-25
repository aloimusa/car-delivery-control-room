"""Speech-to-text through OpenRouter's transcription endpoint, as the decoder behind AsrStream.

No GPU, no local model: each utterance (16 kHz mono float32 from AsrStream) is sent as a WAV to
POST https://openrouter.ai/api/v1/audio/transcriptions and the text comes back in about half a second.
Same interface as AsrService: transcribe_sync(a16) -> str, async transcribe(a16), maybe_unload().
A decode that fails is retried once on the fallback model; a decode that fails twice returns "" and is logged,
never raised (an exception would stop the stream's worker).

Config (phone/config.json): {"asr": {"kind": "openrouter", "model": "mistralai/voxtral-small-transcribe-3-0",
"openrouter": {"fallback": "openai/gpt-transcribe", "language": "en", "timeout_s": 8}}}
Env: OPENROUTER_API_KEY (required), PHONE_ASR_MODEL (overrides the model).

In asr.py's make_service(), before the faster-whisper service is built:
    if cfg["kind"] == "openrouter":
        from asr_or import OpenRouterAsr
        return OpenRouterAsr(model=os.environ.get("PHONE_ASR_MODEL") or cfg["model"], **dict(cfg.get("openrouter", {})))
and in AsrStream.__init__, after interim_f is set:
    if getattr(svc, "no_periodic_interim", False): self.interim_f = 10**9
"""
import asyncio, base64, io, json, os, time, urllib.request, wave
import numpy as np

URL = "https://openrouter.ai/api/v1/audio/transcriptions"

class OpenRouterAsr:
    # AsrStream asks for a decode every 700 ms while the user talks; over a network that is cost and lag for nothing,
    # so only the end-of-turn candidate (spec) and the final are decoded. AsrStream reads this flag.
    no_periodic_interim = True

    def __init__(self, model="mistralai/voxtral-small-transcribe-3-0", fallback="openai/gpt-transcribe", language="en", timeout_s=8.0):
        self.model, self.fallback, self.language, self.timeout = model, fallback, language, float(timeout_s)
        self.key = os.environ.get("OPENROUTER_API_KEY")
        if not self.key: raise SystemExit("asr.kind=openrouter needs OPENROUTER_API_KEY")
        self.last = {"model": None, "s": 0.0, "cost": 0.0}

    @staticmethod
    def _wav(a16: np.ndarray) -> bytes:
        pcm = np.clip(a16, -1, 1)
        pcm = (pcm * 32767).astype("<i2").tobytes()
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(pcm)
        return buf.getvalue()

    def _call(self, model: str, wav: bytes) -> str:
        body = {"model": model, "input_audio": {"data": base64.b64encode(wav).decode(), "format": "wav"}}
        if self.language: body["language"] = self.language
        req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={
            "authorization": f"Bearer {self.key}", "content-type": "application/json", "x-title": "road-desk phone line"})
        t = time.time()
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            out = json.load(r)
        self.last = {"model": model, "s": round(time.time() - t, 2), "cost": (out.get("usage") or {}).get("cost")}
        return (out.get("text") or "").strip()

    def transcribe_sync(self, a16: np.ndarray) -> str:
        if a16 is None or len(a16) < 1600:   # under 100 ms: nothing to hear
            return ""
        wav = self._wav(a16)
        for model in (self.model, self.fallback):
            if not model: continue
            try:
                return self._call(model, wav)
            except Exception as e:   # noqa: BLE001 - the stream must keep running
                print(f"asr openrouter {model} failed: {e!r}", flush=True)
        return ""

    async def transcribe(self, a16):
        return await asyncio.get_running_loop().run_in_executor(None, self.transcribe_sync, a16)

    def maybe_unload(self):
        return False
