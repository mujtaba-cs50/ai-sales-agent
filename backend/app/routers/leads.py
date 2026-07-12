from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models, schemas, auth
from ..database import get_db

router = APIRouter(prefix="/api/leads", tags=["leads"])


@router.get("", response_model=List[schemas.LeadOut])
def list_leads(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    # Single-tenant demo: every logged-in business owner sees all captured
    # leads. For a multi-tenant version, add a business_id column to Lead
    # and filter by current_user.id here.
    leads = db.query(models.Lead).order_by(models.Lead.created_at.desc()).all()
    return leads
