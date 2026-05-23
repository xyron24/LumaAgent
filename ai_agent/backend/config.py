"""
config.py
---------
Single source of truth for all configuration.
Loads environment variables from .env using python-dotenv.
No hardcoded values anywhere in the codebase.
"""

import os
from dotenv import load_dotenv

# Load .env file from the same directory as this script
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))


# --- Gemini ---
GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")

# --- MySQL ---
MYSQL_HOST: str = os.getenv("MYSQL_HOST", "127.0.0.1")
MYSQL_PORT: int = int(os.getenv("MYSQL_PORT", "3306"))
MYSQL_USER: str = os.getenv("MYSQL_USER", "root")
MYSQL_PASSWORD: str = os.getenv("MYSQL_PASSWORD", "")
MYSQL_DB: str = os.getenv("MYSQL_DB", "home_automation")

# --- MQTT ---
MQTT_BROKER: str = os.getenv("MQTT_BROKER", "dev.coppercloud.in")
MQTT_PORT: int = int(os.getenv("MQTT_PORT", "1883"))

# Validate critical keys at startup
if not GEMINI_API_KEY:
    raise EnvironmentError(
        "GEMINI_API_KEY is not set. Please add it to your .env file."
    )
