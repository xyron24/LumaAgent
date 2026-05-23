"""
mqtt_client.py
--------------
Dedicated MQTT client module.

- Connects to the broker and subscribes to all sensor topics.
- Maintains a live in-memory snapshot of the latest sensor readings.
- Exposes publish_command() for the agent to send relay control messages.
- Never crashes the server on broker unavailability — sets a flag instead.
"""

import json
import logging
import threading
import paho.mqtt.client as mqtt

from config import MQTT_BROKER, MQTT_PORT

logger = logging.getLogger(__name__)

# ── In-memory state ──────────────────────────────────────────────────────────
# This dict is updated every time a new MQTT message arrives (~every 2 seconds
# from the ESP8266). The REST API reads from here to serve the dashboard.
latest_sensor_data: dict = {
    "temp": None,
    "humidity": None,
    "ldr": None,
    "pir": None,
    "relay": None,
    "mqtt_connected": False,
}

_client: mqtt.Client | None = None
_lock = threading.Lock()  # Thread-safe writes to latest_sensor_data


# ── Callbacks ────────────────────────────────────────────────────────────────

def _on_connect(client, userdata, flags, rc):
    if rc == 0:
        logger.info("✅ MQTT connected to %s:%s", MQTT_BROKER, MQTT_PORT)
        with _lock:
            latest_sensor_data["mqtt_connected"] = True
        # Subscribe to all sensor topics
        client.subscribe([
            ("home/ldr",   2),
            ("home/pir",   2),
            ("home/dht",   2),
            ("home/relay", 2),
        ])
    else:
        logger.warning("⚠️  MQTT connection failed with code %s", rc)
        with _lock:
            latest_sensor_data["mqtt_connected"] = False


def _on_disconnect(client, userdata, rc):
    logger.warning("⚠️  MQTT disconnected (rc=%s). Will auto-reconnect.", rc)
    with _lock:
        latest_sensor_data["mqtt_connected"] = False


def _on_message(client, userdata, msg):
    topic = msg.topic
    payload = msg.payload.decode("utf-8").strip()

    with _lock:
        try:
            if topic == "home/ldr":
                latest_sensor_data["ldr"] = round(float(payload), 2)

            elif topic == "home/pir":
                latest_sensor_data["pir"] = int(payload)

            elif topic == "home/dht":
                data = json.loads(payload)
                latest_sensor_data["temp"] = round(float(data.get("temp", 0)), 2)
                latest_sensor_data["humidity"] = round(float(data.get("hum", 0)), 2)

            elif topic == "home/relay":
                latest_sensor_data["relay"] = payload  # "ON" or "OFF"

        except (ValueError, json.JSONDecodeError, KeyError) as e:
            logger.error("❌ Failed to parse message on %s: %s | Error: %s", topic, payload, e)


# ── Public API ────────────────────────────────────────────────────────────────

def start():
    """Initialize and connect the MQTT client in a background thread."""
    global _client
    try:
        _client = mqtt.Client(client_id="IoT_AI_Agent_Server")
        _client.on_connect    = _on_connect
        _client.on_disconnect = _on_disconnect
        _client.on_message    = _on_message

        _client.connect_async(MQTT_BROKER, MQTT_PORT, keepalive=60)
        _client.loop_start()  # Non-blocking background thread
        logger.info("🔌 MQTT client started. Connecting to %s...", MQTT_BROKER)

    except Exception as e:
        # Do NOT raise — server should start even if MQTT is temporarily down
        logger.error("❌ MQTT client failed to start: %s", e)
        with _lock:
            latest_sensor_data["mqtt_connected"] = False


def stop():
    """Cleanly disconnect the MQTT client."""
    global _client
    if _client:
        _client.loop_stop()
        _client.disconnect()
        logger.info("🔌 MQTT client disconnected.")


def publish_command(topic: str, message: str) -> dict:
    """
    Publish a control command to the MQTT broker.
    Returns a result dict so the agent can report success/failure naturally.
    """
    if _client is None or not latest_sensor_data.get("mqtt_connected"):
        return {"success": False, "error": "MQTT broker is not connected. Command not sent."}

    try:
        result = _client.publish(topic, message, qos=1)
        if result.rc == mqtt.MQTT_ERR_SUCCESS:
            logger.info("📤 Published '%s' to '%s'", message, topic)
            return {"success": True, "topic": topic, "message": message}
        else:
            return {"success": False, "error": f"Publish failed with code {result.rc}"}
    except Exception as e:
        logger.error("❌ Publish error: %s", e)
        return {"success": False, "error": str(e)}
