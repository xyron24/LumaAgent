"""
app.py
------
Core FastAPI application — the entry point for the entire backend.

What this does:
- Starts the MQTT client on server startup (lifespan event).
- Initializes the MySQL connection pool on startup.
- Serves the frontend (index.html, style.css, script.js) as static files at /
  → This eliminates ALL browser CORS errors since frontend and backend
    share the same origin (http://localhost:8000).
- Exposes two REST API endpoints:
    GET  /api/status  → Returns live sensor data from the MQTT in-memory state
    POST /api/chat    → Entry point for the AI agent (wired up in Phase 2)
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

import mqtt_client
import db_client
import agent

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


# ── Lifespan: startup & shutdown ──────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Runs setup code before the server starts accepting requests,
    and teardown code when the server shuts down.
    This is the modern FastAPI pattern (replaces @app.on_event).
    """
    logger.info("🚀 Server starting up...")
    mqtt_client.start()   # Connect to MQTT broker in background thread
    db_client.init_pool() # Create MySQL connection pool
    yield
    logger.info("🛑 Server shutting down...")
    mqtt_client.stop()    # Cleanly disconnect MQTT


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="LumaAgent API",
    description="LLM-powered backend for the smart lighting IoT system.",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware — allows the frontend to call the API even during
# local development when served from a different port.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── API Endpoints ─────────────────────────────────────────────────────────────

@app.get("/api/status", summary="Get live sensor data")
def get_status():
    """
    Returns the latest sensor readings from the ESP8266 via MQTT.
    The frontend polls this every 3 seconds to update the dashboard cards.

    Response example:
    {
        "temp": 28.5,
        "humidity": 65.2,
        "ldr": 42.3,
        "pir": 1,
        "relay": "ON",
        "mqtt_connected": true
    }
    """
    return mqtt_client.latest_sensor_data


class ChatRequest(BaseModel):
    message: str


@app.post("/api/chat", summary="Send a message to the AI agent")
async def chat(request: ChatRequest):
    """
    Receives a natural language message and returns the AI agent's response.
    The agent may call one or more tools internally (MQTT, MySQL) before
    producing the final answer — all of this is transparent to the user.

    Uses run_in_executor to prevent the blocking Gemini API call from
    freezing the FastAPI event loop (keeps the server responsive).
    """
    import asyncio
    loop = asyncio.get_event_loop()
    logger.info("💬 Chat: %s", request.message)

    response_text = await loop.run_in_executor(
        None,                   # Default ThreadPoolExecutor
        agent.run,              # The blocking function
        request.message,        # Argument
    )
    return {"response": response_text}


@app.get("/api/scheduled", summary="List pending scheduled actions")
def get_scheduled():
    """
    Returns all relay actions currently scheduled but not yet executed.
    Useful for the dashboard to show 'Light will turn off at 14:30'.
    """
    safe_timers = [
        {"mode": t["mode"], "fires_at": t["fires_at"]}
        for t in agent._scheduled_timers
    ]
    return {"scheduled": safe_timers, "count": len(safe_timers)}


# ── Static File Serving ───────────────────────────────────────────────────────
# Serve frontend at / — this must come AFTER API routes are defined
# so /api/* routes take priority over static file matching.
import os
frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")

if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")
    logger.info("🌐 Frontend served from: %s", os.path.abspath(frontend_path))
else:
    logger.warning("⚠️  Frontend directory not found at %s — skipping static mount.", frontend_path)
