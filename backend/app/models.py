from datetime import datetime

from sqlalchemy import Column, Integer, String, DateTime, Text
from .database import Base


class User(Base):
    """Business owner account (User Management Module)."""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    business_name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Lead(Base):
    """Captured sales lead (Lead Extraction Module)."""

    __tablename__ = "leads"

    id = Column(Integer, primary_key=True, index=True)
    customer_name = Column(String, default="Website Visitor")
    city = Column(String, default="Online inquiry")
    phone_number = Column(String, default="Not provided")
    interest = Column(String, default="Solar Package")
    budget = Column(String, default="Not specified")
    timeline = Column(String, default="Not specified")
    note = Column(Text, default="")
    status = Column(String, default="New")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ConversationLog(Base):
    """One turn of a customer <-> AI conversation (Conversation Logs feature)."""

    __tablename__ = "conversation_logs"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, index=True)
    speaker = Column(String)  # "customer" | "agent"
    message = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
