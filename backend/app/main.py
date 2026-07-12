from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import models
from .database import engine
from .routers import auth, chat, leads, tts

# Create tables on startup (simple approach for an FYP project - no migrations needed)
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="AI Sales Agent API", version="1.0.0")

app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(leads.router)
app.include_router(tts.router)

# Serve the existing HTML/CSS/JS frontend as-is, from ../frontend
FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
