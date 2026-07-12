from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models, schemas, dialogue
from ..database import get_db

router = APIRouter(prefix="/api/chat", tags=["chat"])

# In-memory session store: {session_id: state_dict}
# Fine for a single-process FYP demo. For production, move this into
# Redis or the database keyed by session_id.
_SESSIONS: dict = {}


@router.post("", response_model=schemas.ChatResponse)
def chat(payload: schemas.ChatRequest, db: Session = Depends(get_db)):
    state = _SESSIONS.get(payload.session_id) or dialogue.new_session_state()

    reply, state, lead_captured = dialogue.generate_reply(state, payload.message)
    _SESSIONS[payload.session_id] = state

    # Log both sides of the conversation
    db.add(models.ConversationLog(session_id=payload.session_id, speaker="customer", message=payload.message))
    db.add(models.ConversationLog(session_id=payload.session_id, speaker="agent", message=reply))

    if lead_captured:
        lead_data = dialogue.build_lead_dict(state)
        db.add(models.Lead(**lead_data))

    db.commit()

    return schemas.ChatResponse(reply=reply, stage=state["stage"], lead_captured=lead_captured)
