# The phone line without a GPU

The live calls run on the `duplexphone` server (not in this repository) with one contact, `roaddesk`: speech in,
DeepSeek v4 pro with the order's dossier from the call service, ElevenLabs speech out. Speech in used a local Whisper
on the box's GPU; it now goes through OpenRouter's transcription endpoint, so the whole line needs nothing but an
OpenRouter key.

- `asr_or.py` is the decoder: drop it next to the phone server's `asr.py`, and in `phone/config.json` set
  `{"asr": {"kind": "openrouter", "model": "mistralai/voxtral-small-transcribe-3-0", "openrouter": {"fallback": "openai/gpt-transcribe", "language": "en", "timeout_s": 8}}}`.
  `asr.py`'s `make_service()` needs the three-line `openrouter` branch shown at the top of `asr_or.py`'s docstring, and
  `AsrStream` reads the decoder's `no_periodic_interim` flag so only the end of a turn is decoded.
- Measured on a 6 s turn from the box: Voxtral Small Transcribe 3 0.5 s, GPT Transcribe 0.7 s, ElevenLabs Scribe v2 1.0 s,
  Deepgram Nova-3 1.0 s; all four transcribed it correctly. The fastest is the default, the second the fallback.
- Env: `OPENROUTER_API_KEY`; `PHONE_ASR_MODEL` overrides the model.
