from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr


# ---------- Auth ----------
class SignupRequest(BaseModel):
    business_name: str
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    business_name: str


# ---------- Chat ----------
class ChatRequest(BaseModel):
    session_id: str
    message: str


class ChatResponse(BaseModel):
    reply: str
    stage: str
    lead_captured: bool = False


# ---------- Leads ----------
class LeadOut(BaseModel):
    id: int
    customer_name: str
    city: str
    phone_number: str
    interest: str
    budget: str
    timeline: str
    note: str
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


# ---------- TTS ----------
class TTSRequest(BaseModel):
    text: str
