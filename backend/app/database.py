"""
Database configuration.

Uses SQLite by default (zero setup, single file: backend/sales_agent.db).
This matches Log Form #6 of the FYP report, which lists SQLite as a
dependency, while the SRS mentions MongoDB as a stretch option. SQLite
was chosen for the working prototype because it needs no external
server and is perfect for a final-year-project demo. If you want Mongo
later, only this file and models.py need to change.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

SQLALCHEMY_DATABASE_URL = "sqlite:///./sales_agent.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
