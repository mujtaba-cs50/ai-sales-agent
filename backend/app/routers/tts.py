from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from .. import schemas
from ..tts import synthesize_speech

router = APIRouter(prefix="/api/tts", tags=["tts"])


@router.post("")
def text_to_speech(payload: schemas.TTSRequest):
    try:
        audio_bytes = synthesize_speech(payload.text)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return Response(content=audio_bytes, media_type="audio/mpeg")
