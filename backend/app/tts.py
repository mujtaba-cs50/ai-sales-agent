"""
Text-to-Speech Module (SRS 3.4 - gTTS).

gTTS calls Google's public translate-TTS endpoint, so the machine running
this backend needs internet access. If you are offline, /api/tts will
return a 503 and the frontend will simply skip audio playback and show
the text reply only.
"""

import io
from gtts import gTTS
from gtts.tts import gTTSError


def synthesize_speech(text: str) -> bytes:
    if not text or not text.strip():
        text = "Sorry, I do not have a response for that."
    tts = gTTS(text=text, lang="en")
    buffer = io.BytesIO()
    try:
        tts.write_to_fp(buffer)
    except gTTSError as exc:
        raise RuntimeError(f"gTTS failed (check internet connection): {exc}")
    buffer.seek(0)
    return buffer.read()
