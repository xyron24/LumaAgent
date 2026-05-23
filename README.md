# ⚡ LumaAgent: MQTT-Driven Edge Sensing System with LLM-Powered IoT Agent

> An end-to-end smart lighting system that combines **real-time IoT sensing** with a **Generative AI operations agent (LumaAgent)** — capable of controlling hardware, querying historical data, and executing dynamic time-based policies through natural language.

---

## 🧠 What Makes This Different

Most IoT lighting systems use **static rule-based thresholds** — if motion is detected AND light is low, turn ON. Simple. Predictable. Limited.

This project replaces and extends that paradigm with an **LLM-powered agent** that acts as an intelligent operations layer on top of the hardware:

| Capability | Traditional IoT | This System |
|---|---|---|
| Lighting control | Fixed rules only | Natural language + rules + AI reasoning |
| Analytics | Pre-built Grafana charts | Ad-hoc SQL via text-to-query |
| Scheduling | None | *"Turn off in 10 minutes"* → real timer |
| Context awareness | None | Remembers conversation context |
| Occupancy override | Sensor must detect motion | User can declare intent: *"I'm reading for 2 hours"* |

---

## 🏗️ System Architecture

```
                          ┌──────────────────────────────┐
                          │      Web Dashboard           │
                          │  (HTML / CSS / Vanilla JS)   │
                          │  Sensor Cards  |  AI Chat    │
                          └──────────┬───────────────────┘
                                     │ HTTP REST (same origin)
                          ┌──────────▼───────────────────┐
                          │     FastAPI Backend           │
                          │  (Python · Async · Uvicorn)  │
                          └──────┬──────────┬────────────┘
                                 │          │
              ┌──────────────────▼──┐   ┌───▼─────────────────┐
              │   Gemini 2.5 Flash  │   │   MySQL Database     │
              │   (Function Calling)│   │   home_automation    │
              │   ReAct Agent Loop  │   │   sensor_data table  │
              └──────────┬──────────┘   └─────────────────────┘
                         │ Tool calls
          ┌──────────────▼──────────────────────────┐
          │            Agent Tools                   │
          │  get_sensor_status │ query_db            │
          │  set_relay_mode    │ schedule_action      │
          └──────┬─────────────────────┬────────────┘
                 │ paho-mqtt           │ mysql-connector
    ┌────────────▼──────────┐   ┌──────▼──────────────────┐
    │   MQTT Broker         │   │   Node-RED               │
    │ dev.coppercloud.in    │   │   (Flow processor)       │
    └────────────┬──────────┘   └──────────────────────────┘
                 │ Wi-Fi (MQTT)
    ┌────────────▼──────────────────────────────────────────┐
    │              ESP8266 NodeMCU                           │
    │   DHT11 · PIR Sensor · LDR Sensor · Relay Module      │
    └───────────────────────────────────────────────────────┘
```

---

## 🚀 Key Features

### Hardware Layer
- ⚡ **Motion-based lighting** — PIR sensor triggers relay
- 🌙 **Ambient light control** — LDR prevents lights turning on in bright rooms
- ⏱️ **Timer-based auto-OFF** — configurable hold time after last motion
- 🔁 **Dual modes** — AUTO (sensor-driven) and MANUAL (command-driven)

### AI Agent Layer
- 🤖 **Natural language control** — *"Turn off the light in 10 minutes"*
- 📊 **Text-to-SQL analytics** — *"How long was the light on yesterday?"*
- 🔒 **SQL injection protection** — agent can only run `SELECT` queries
- 🔄 **ReAct agent loop** — Gemini reasons → calls tool → reasons again → answers
- 📡 **Live sensor context** — agent reads real-time MQTT data before answering
- ⏰ **Dynamic policy engine** — scheduled commands via `threading.Timer`

### Dashboard
- 🌡️ Live sensor cards with flash animations on value change
- 💡 One-click relay control (ON / AUTO / OFF)
- 💬 AI chat interface with typing indicator and markdown rendering
- 🕐 Scheduled actions panel

---

## 🧰 Tech Stack

| Layer | Technology |
|---|---|
| **Edge Device** | ESP8266 NodeMCU (Arduino C++) |
| **Sensors** | DHT11 · PIR · LDR |
| **Messaging** | MQTT (paho-mqtt · dev.coppercloud.in) |
| **Flow Processing** | Node-RED |
| **Database** | MySQL (`home_automation.sensor_data`) |
| **Visualization** | Grafana |
| **AI Model** | Google Gemini 2.5 Flash (Function Calling) |
| **Backend** | Python · FastAPI · Uvicorn |
| **Frontend** | HTML · Vanilla CSS · Vanilla JS |

---

## 📂 Project Structure

```
project-iot/
├── esp8266_code/
│   ├── main.ino              ← ESP8266 firmware (credentials redacted)
│   └── secrets.h.example     ← Credential template (copy → secrets.h)
├── node-red/
│   └── flows.json            ← MQTT → MySQL pipeline
├── database/
│   └── schema.sql            ← sensor_data table definition
├── dashboard/
│   └── grafana.txt           ← Grafana panel reference
├── images/
│   └── ...
├── ai_agent/                 ← AI Agent layer (new)
│   ├── backend/
│   │   ├── .env.example      ← API key / DB credential template
│   │   ├── .gitignore        ← Protects real .env from Git
│   │   ├── requirements.txt
│   │   ├── config.py         ← Single source of truth for all settings
│   │   ├── mqtt_client.py    ← Background MQTT thread + live sensor state
│   │   ├── db_client.py      ← MySQL pool + SELECT-only security guard
│   │   ├── agent.py          ← Gemini ReAct loop + 4 tool implementations
│   │   └── app.py            ← FastAPI server + static file serving
│   └── frontend/
│       ├── index.html
│       ├── style.css
│       └── script.js
└── README.md
```

---

## ⚙️ How to Run

### Prerequisites
- Python 3.9+
- MySQL running locally with `home_automation` database
- Node-RED running and pushing data to MySQL
- Gemini API key from [aistudio.google.com](https://aistudio.google.com)

### Step 1 — Arduino Setup
```bash
# In esp8266_code/
cp secrets.h.example secrets.h
# Edit secrets.h with your WiFi credentials
# Flash main.ino to your NodeMCU via Arduino IDE
```

### Step 2 — Backend Setup
```bash
cd ai_agent/backend
cp .env.example .env
# Edit .env with your GEMINI_API_KEY and MySQL password

pip install -r requirements.txt
python -m uvicorn app:app --host 0.0.0.0 --port 8000
```

### Step 3 — Open Dashboard
```
http://localhost:8000
```

That's it. One server. No separate frontend build step.

---

## 🤖 Agent Capabilities — Example Queries

| User Query | What the Agent Does |
|---|---|
| *"What is the current temperature?"* | Calls `get_current_sensor_status()` → returns live DHT11 reading |
| *"How long was the light on yesterday?"* | Generates `SELECT SUM(...)` → queries MySQL → calculates duration |
| *"Turn off the light in 10 minutes"* | Calls `schedule_relay_action("OFF", 10)` → sets `threading.Timer` |
| *"Was anyone home after 10 PM last night?"* | Text-to-SQL on PIR column with time filter |
| *"Switch to AUTO mode"* | Publishes `AUTO` to `home/relay/control` via MQTT |
| *"What's the average humidity this week?"* | Runs `SELECT AVG(HUMIDITY)` with `WHERE TIMESTAMP >= ...` |

---

## 🔐 Security Design

| Risk | Mitigation |
|---|---|
| API key exposure | Stored in `.env` — listed in `.gitignore`, never committed |
| WiFi credentials in firmware | Moved to `secrets.h` — listed in `.gitignore` |
| LLM prompt injection → SQL write | `db_client.run_read_query()` rejects all non-SELECT statements before execution |
| LLM issuing invalid relay commands | `set_relay_mode()` validates against allowed values (`ON`/`OFF`/`AUTO`) |
| CORS attacks from rogue pages | Frontend served by FastAPI at same origin — no external origin allowed |

---

## 🎯 Interview Q&A

### Q1: "Why do you need AI? PIR sensors already automate the lighting."

**A:** Static PIR sensors are "dumb" — they can't understand context. If I'm sitting still at my desk reading a book, the sensor reads 0 motion and turns the light off, forcing me to wave my arms. The AI agent lets me say *"I'm working at my desk for the next 2 hours, adjust accordingly"* — it temporarily overrides the timeout and restores AUTO mode automatically at the end. That's **dynamic policy orchestration**, which no static sensor can do.

---

### Q2: "You already have Grafana dashboards — why add an AI chat interface?"

**A:** Grafana is excellent for pre-built, structured charts. But it can't answer **ad-hoc analytical questions** like *"Was the light left on while nobody was home yesterday, and for how long?"* That would require writing SQL manually. The AI agent uses **Text-to-SQL** to safely translate natural language into `SELECT` queries, execute them against MySQL, and explain the result in plain English. It democratises data access.

---

### Q3: "How do you prevent the LLM from doing something dangerous, like deleting your database?"

**A:** Three layers of defence:
1. The system prompt instructs Gemini that only `SELECT` queries are permitted.
2. The `db_client.run_read_query()` function inspects every SQL string before execution — any query not starting with `SELECT`, or containing keywords like `DROP`, `DELETE`, or `INSERT`, is rejected with an error returned to the LLM.
3. The relay tool only accepts three hard-coded values: `ON`, `OFF`, `AUTO` — any other string is rejected.

This is defence-in-depth — not relying solely on the LLM to behave.

---

### Q4: "What is the ReAct agent loop?"

**A:** ReAct stands for **Reason + Act**. In each turn:
1. I send the user's message to Gemini along with the tool definitions.
2. Gemini *reasons* about what it needs and *acts* by returning a `function_call` — not a text answer.
3. My Python code executes that function (e.g., queries MySQL) and sends the result back to Gemini.
4. Gemini reasons again with the new information and either calls another tool or produces a final text answer.

This loop runs up to 8 turns. It's the same pattern used in production AI agent systems — Google's own agents, LangChain, AutoGPT, etc.

---

### Q5: "What happens if the MQTT broker or MySQL goes down?"

**A:** The system is designed to **fail gracefully, not crash**. If MQTT disconnects, the client sets a flag (`mqtt_connected = False`) and auto-reconnects in the background — the server keeps running. If MySQL is unavailable, `db_client.init_pool()` logs the error but doesn't throw — the agent returns `"Database is unavailable right now"` to the user. The server never crashes on external dependency failure.

---

## 🔮 Future Scope

- [ ] Predictive occupancy modelling (ML on historical PIR data)
- [ ] Multi-room scalability via MQTT topic namespacing
- [ ] Mobile app with push notifications on energy waste alerts
- [ ] Voice interface (Web Speech API → chat endpoint)
- [ ] LLM-generated weekly energy usage reports via email

---

## 📊 Dashboard Preview

### 📈 Grafana Dashboard
![Grafana Dashboard](images/combined.jpeg)

### 🔄 Node-RED Flow
![Node-RED Flow](images/nodered.jpeg)

---

## 👨‍💻 Author

**Vaibhav (xyron24)**

---

## 📌 Conclusion

This project demonstrates a **full-stack IoT + GenAI integration** — from edge sensing on embedded hardware, through real-time MQTT messaging, to a production-grade AI agent with function calling, SQL analytics, and a live web dashboard. Every architectural decision was made to solve a real problem, not to add complexity for its own sake.
