"""
agent.py
--------
The AI brain of the IoT system — powered by Google Gemini with Function Calling.

How it works (for interviews):
--------------------------------
This implements a classic "ReAct" (Reason + Act) agent loop:
  1. User sends a natural language message.
  2. Gemini reads the message + system context and decides if it needs to call a tool.
  3. If yes → we execute the tool (Python function) and send the result back to Gemini.
  4. Gemini reasons over the result and either calls another tool or gives a final answer.
  5. This loop repeats until Gemini produces a plain text response (no more tool calls).

Tools (Functions exposed to Gemini):
  - get_current_sensor_status()          → Live data from MQTT in-memory state
  - query_sensor_history(sql)            → Read-only MySQL analytics queries
  - set_relay_mode(mode)                 → Publish ON/OFF/AUTO to MQTT broker
  - schedule_relay_action(mode, minutes) → Delayed relay command via threading.Timer

Security design:
  - Gemini never touches MQTT or MySQL directly.
  - All tool calls go through our validated Python functions.
  - The DB tool rejects any non-SELECT SQL before it reaches MySQL.
  - The relay tool only accepts the three known modes (ON/OFF/AUTO).
"""

import logging
import threading
import datetime
from typing import Any

from google import genai
from google.genai import types

import mqtt_client
import db_client
from config import GEMINI_API_KEY

logger = logging.getLogger(__name__)

# ── Gemini client ─────────────────────────────────────────────────────────────
_gemini = genai.Client(api_key=GEMINI_API_KEY)
MODEL = "gemini-2.5-flash"

# ── Scheduled action tracker ──────────────────────────────────────────────────
# Stores active timers so we can report them to the user if needed.
_scheduled_timers: list[dict] = []


# ═══════════════════════════════════════════════════════════════════════════════
# TOOL IMPLEMENTATIONS
# These are the actual Python functions that run when Gemini calls a tool.
# ═══════════════════════════════════════════════════════════════════════════════

def _tool_get_current_sensor_status() -> dict:
    """
    Returns the latest live sensor readings received from the ESP8266 via MQTT.
    Use this for any question about the CURRENT state of the room.
    Examples: "What is the temperature?", "Is someone in the room?", "Is the light on?"
    """
    data = mqtt_client.latest_sensor_data.copy()
    if not data.get("mqtt_connected"):
        return {"error": "MQTT broker is not connected. Real-time data is unavailable."}
    if data.get("temp") is None:
        return {"error": "No sensor data received yet. The ESP8266 may be offline."}
    return {
        "temperature_celsius": data.get("temp"),
        "humidity_percent": data.get("humidity"),
        "light_intensity_percent": data.get("ldr"),
        "motion_detected": bool(data.get("pir")),
        "relay_state": data.get("relay"),
        "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


def _tool_query_sensor_history(sql_query: str) -> dict:
    """
    Executes a read-only SQL SELECT query on the sensor_data table in MySQL.
    Use this for any HISTORICAL or ANALYTICAL question.
    Examples: "How long was the light on yesterday?", "Average temperature this week",
              "How many times was motion detected today?"

    Database schema:
      TABLE sensor_data (
        ID        INT AUTO_INCREMENT PRIMARY KEY,
        TIMESTAMP DATETIME DEFAULT CURRENT_TIMESTAMP,
        PIR       INT,          -- 1 = motion detected, 0 = no motion
        LDR       FLOAT,        -- Light intensity percentage (0-100)
        TEMP      FLOAT,        -- Temperature in Celsius
        HUMIDITY  FLOAT,        -- Humidity percentage
        RELAY     VARCHAR(10)   -- 'ON' or 'OFF'
      )

    IMPORTANT: Only generate SELECT queries. Never use INSERT, UPDATE, DELETE, or DROP.
    """
    return db_client.run_read_query(sql_query)


def _tool_set_relay_mode(mode: str) -> dict:
    """
    Controls the smart light relay by publishing a command to the MQTT broker.
    The ESP8266 NodeMCU picks this up instantly over Wi-Fi.

    mode options:
      "ON"   → Turn the light ON (Manual mode override)
      "OFF"  → Turn the light OFF (Manual mode override)
      "AUTO" → Return to automatic PIR + LDR based control

    Use this when the user wants to control the light immediately.
    """
    mode = mode.strip().upper()
    if mode not in ("ON", "OFF", "AUTO"):
        return {"error": f"Invalid mode '{mode}'. Must be one of: ON, OFF, AUTO."}

    result = mqtt_client.publish_command("home/relay/control", mode)
    if result.get("success"):
        descriptions = {
            "ON":   "Light turned ON manually.",
            "OFF":  "Light turned OFF manually.",
            "AUTO": "System returned to AUTO mode (PIR + LDR control).",
        }
        return {"success": True, "action": mode, "message": descriptions[mode]}
    return result


def _tool_schedule_relay_action(mode: str, delay_minutes: int) -> dict:
    """
    Schedules a relay command to execute after a delay.
    Use this for time-based commands like "turn off the light in 10 minutes".

    mode          → "ON", "OFF", or "AUTO"
    delay_minutes → How many minutes to wait before executing the command (1-120)
    """
    mode = mode.strip().upper()
    if mode not in ("ON", "OFF", "AUTO"):
        return {"error": f"Invalid mode '{mode}'. Must be ON, OFF, or AUTO."}

    if not (1 <= delay_minutes <= 120):
        return {"error": "delay_minutes must be between 1 and 120."}

    fire_at = datetime.datetime.now() + datetime.timedelta(minutes=delay_minutes)
    fire_at_str = fire_at.strftime("%H:%M:%S")

    def _execute():
        logger.info("⏰ Scheduled action firing: relay → %s", mode)
        mqtt_client.publish_command("home/relay/control", mode)
        # Remove from tracker after firing
        _scheduled_timers[:] = [t for t in _scheduled_timers if t.get("mode") != mode]

    timer = threading.Timer(delay_minutes * 60, _execute)
    timer.daemon = True  # Timer dies if the server shuts down (no zombie threads)
    timer.start()

    _scheduled_timers.append({"mode": mode, "fires_at": fire_at_str, "timer": timer})
    logger.info("⏰ Scheduled relay '%s' in %d min (at %s)", mode, delay_minutes, fire_at_str)

    return {
        "success": True,
        "scheduled_action": mode,
        "fires_at": fire_at_str,
        "delay_minutes": delay_minutes,
    }


# ── Tool name → callable map ──────────────────────────────────────────────────
TOOL_MAP: dict[str, Any] = {
    "get_current_sensor_status": _tool_get_current_sensor_status,
    "query_sensor_history":      _tool_query_sensor_history,
    "set_relay_mode":            _tool_set_relay_mode,
    "schedule_relay_action":     _tool_schedule_relay_action,
}


# ═══════════════════════════════════════════════════════════════════════════════
# TOOL DECLARATIONS (Schema sent to Gemini so it knows what tools exist)
# ═══════════════════════════════════════════════════════════════════════════════

_TOOLS = types.Tool(function_declarations=[

    types.FunctionDeclaration(
        name="get_current_sensor_status",
        description=(
            "Returns the latest live sensor readings from the ESP8266 via MQTT. "
            "Use for any question about the CURRENT state: temperature, humidity, "
            "light level, motion, or relay status."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={},  # No parameters needed — reads live in-memory state
        ),
    ),

    types.FunctionDeclaration(
        name="query_sensor_history",
        description=(
            "Executes a read-only SELECT query on the sensor_data MySQL table. "
            "Use for HISTORICAL or ANALYTICAL questions: energy usage, occupancy patterns, "
            "average temperature over time, how long the light was on, etc. "
            "Schema: sensor_data(ID, TIMESTAMP, PIR INT, LDR FLOAT, TEMP FLOAT, HUMIDITY FLOAT, RELAY VARCHAR). "
            "Only generate SELECT queries — write operations are blocked."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "sql_query": types.Schema(
                    type=types.Type.STRING,
                    description="A valid MySQL SELECT query on the sensor_data table.",
                ),
            },
            required=["sql_query"],
        ),
    ),

    types.FunctionDeclaration(
        name="set_relay_mode",
        description=(
            "Controls the smart light relay immediately by publishing to the MQTT broker. "
            "Use when the user wants to turn the light ON, OFF, or switch to AUTO mode."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "mode": types.Schema(
                    type=types.Type.STRING,
                    description="Relay command. Must be exactly 'ON', 'OFF', or 'AUTO'.",
                ),
            },
            required=["mode"],
        ),
    ),

    types.FunctionDeclaration(
        name="schedule_relay_action",
        description=(
            "Schedules a relay command to execute after a specified delay in minutes. "
            "Use for time-based commands like 'turn off the light in 10 minutes' or "
            "'switch to AUTO mode in half an hour'."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "mode": types.Schema(
                    type=types.Type.STRING,
                    description="Relay command to schedule: 'ON', 'OFF', or 'AUTO'.",
                ),
                "delay_minutes": types.Schema(
                    type=types.Type.INTEGER,
                    description="Number of minutes to wait before executing (1-120).",
                ),
            },
            required=["mode", "delay_minutes"],
        ),
    ),

])


# ═══════════════════════════════════════════════════════════════════════════════
# SYSTEM PROMPT
# This is the "personality" and "rules" given to Gemini before every conversation.
# ═══════════════════════════════════════════════════════════════════════════════

SYSTEM_PROMPT = """
You are LumaAgent, an intelligent IoT Operations Analyst and smart home assistant for a 
real-time edge sensing system. You manage a smart lighting system built on:
  - ESP8266 NodeMCU with DHT11 (temperature/humidity), PIR (motion), LDR (light) sensors
  - MQTT broker for real-time messaging
  - MySQL database for historical sensor data
  - Relay-controlled lighting

Your capabilities:
  1. Answer questions about CURRENT sensor readings using get_current_sensor_status.
  2. Perform HISTORICAL analytics using query_sensor_history (read-only SQL).
  3. CONTROL the light immediately using set_relay_mode (ON/OFF/AUTO).
  4. SCHEDULE future actions using schedule_relay_action.

Rules you must always follow:
  - Be concise, precise, and informative. Avoid unnecessary filler text.
  - Always call the appropriate tool before answering data-related questions.
  - For SQL queries: only write SELECT statements. Never INSERT, UPDATE, DELETE, or DROP.
  - When reporting sensor values, always include units (°C, %, etc.).
  - If a tool returns an error, report it clearly and suggest a possible cause.
  - When you schedule an action, always confirm the exact time it will fire.
  - You are LumaAgent — speak confidently and helpfully.
""".strip()


# ═══════════════════════════════════════════════════════════════════════════════
# AGENTIC LOOP
# This is the core engine — the multi-turn function-calling loop.
# ═══════════════════════════════════════════════════════════════════════════════

def run(user_message: str) -> str:
    """
    Entry point: takes a user's natural language message and returns
    the agent's final text response after executing any required tool calls.

    The loop:
      Turn 1: User message → Gemini → (maybe) function_call
      Turn 2: function_response → Gemini → (maybe) another function_call
      ...
      Turn N: Gemini produces a text response → return to user

    Max 8 turns to prevent infinite loops on unexpected model behaviour.
    """
    logger.info("🤖 Agent received: %s", user_message)

    # Build the conversation history starting with the user's message
    contents: list[types.Content] = [
        types.Content(role="user", parts=[types.Part(text=user_message)])
    ]

    max_turns = 8
    for turn in range(max_turns):
        logger.info("🔄 Agent loop turn %d/%d", turn + 1, max_turns)

        # ── Ask Gemini ────────────────────────────────────────────────────────
        try:
            response = _gemini.models.generate_content(
                model=MODEL,
                contents=contents,
                config=types.GenerateContentConfig(
                    tools=[_TOOLS],
                    system_instruction=SYSTEM_PROMPT,
                    temperature=0.2,  # Lower = more deterministic/factual
                ),
            )
        except Exception as e:
            logger.error("❌ Gemini API error: %s", e)
            return f"I encountered an error communicating with the AI model: {str(e)}"

        candidate = response.candidates[0]
        model_content = candidate.content

        # Add the model's response to the conversation history
        contents.append(model_content)

        # ── Check for function calls ──────────────────────────────────────────
        function_call_parts = [
            part for part in model_content.parts
            if part.function_call is not None
        ]

        # No function calls → Gemini has a final text answer
        if not function_call_parts:
            text_parts = [
                part.text for part in model_content.parts
                if part.text
            ]
            final_answer = " ".join(text_parts).strip()
            logger.info("✅ Agent final answer (%d chars)", len(final_answer))
            return final_answer or "I completed the action but have no further response."

        # ── Execute all tool calls ────────────────────────────────────────────
        function_response_parts: list[types.Part] = []

        for part in function_call_parts:
            fc = part.function_call
            tool_name = fc.name
            tool_args = dict(fc.args) if fc.args else {}

            logger.info("🔧 Tool call: %s(%s)", tool_name, tool_args)

            # Look up and call the tool
            tool_fn = TOOL_MAP.get(tool_name)
            if tool_fn:
                try:
                    tool_result = tool_fn(**tool_args)
                except TypeError as e:
                    tool_result = {"error": f"Invalid arguments for {tool_name}: {str(e)}"}
                except Exception as e:
                    tool_result = {"error": f"Tool {tool_name} failed: {str(e)}"}
            else:
                tool_result = {"error": f"Unknown tool '{tool_name}'. This should not happen."}

            logger.info("📦 Tool result for %s: %s", tool_name, str(tool_result)[:200])

            # Package the result to send back to Gemini
            function_response_parts.append(
                types.Part(
                    function_response=types.FunctionResponse(
                        name=tool_name,
                        response=tool_result,
                    )
                )
            )

        # Add all tool results to the conversation as a "user" turn
        contents.append(
            types.Content(role="user", parts=function_response_parts)
        )

    # Safety: if we hit max_turns without a final text response
    logger.warning("⚠️ Agent hit max turn limit (%d). Returning fallback.", max_turns)
    return (
        "I was processing your request but reached the maximum reasoning steps. "
        "Please try rephrasing your question."
    )
