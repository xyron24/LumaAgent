import { GoogleGenAI } from '@google/genai';
import * as mqttClient from './mqttClient.js';
import * as dbClient from './dbClient.js';
import { GEMINI_API_KEY } from './config.js';

// Initialize the Gemini client
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const MODEL = 'gemini-2.5-flash';

// Stores active timers so we can report them to the user.
export const scheduledTimers = [];

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════════════════════

function toolGetCurrentSensorStatus() {
  console.log('🔧 Running tool: get_current_sensor_status');
  const data = { ...mqttClient.latestSensorData };

  if (!data.mqtt_connected) {
    return { error: 'MQTT broker is not connected. Real-time data is unavailable.' };
  }
  if (data.temp === null) {
    return { error: 'No sensor data received yet. The ESP8266 may be offline.' };
  }

  // Format date as YYYY-MM-DD HH:MM:SS
  const now = new Date();
  const timestamp = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0') + ' ' +
    String(now.getHours()).padStart(2, '0') + ':' +
    String(now.getMinutes()).padStart(2, '0') + ':' +
    String(now.getSeconds()).padStart(2, '0');

  return {
    temperature_celsius: data.temp,
    humidity_percent: data.humidity,
    light_intensity_percent: data.ldr,
    motion_detected: Boolean(data.pir),
    relay_state: data.relay,
    timestamp: timestamp,
  };
}

async function toolQuerySensorHistory(args) {
  const sqlQuery = args.sql_query || args.sqlQuery;
  console.log(`🔧 Running tool: query_sensor_history | SQL: ${sqlQuery}`);
  if (!sqlQuery) {
    return { success: false, error: 'No sql_query parameter provided.' };
  }
  return await dbClient.runReadQuery(sqlQuery);
}

async function toolSetRelayMode(args) {
  let mode = args.mode || '';
  mode = mode.trim().toUpperCase();
  console.log(`🔧 Running tool: set_relay_mode | Mode: ${mode}`);

  if (!['ON', 'OFF', 'AUTO'].includes(mode)) {
    return { error: `Invalid mode '${mode}'. Must be one of: ON, OFF, AUTO.` };
  }

  const result = await mqttClient.publishCommand('home/relay/control', mode);
  if (result.success) {
    const descriptions = {
      ON: 'Light turned ON manually.',
      OFF: 'Light turned OFF manually.',
      AUTO: 'System returned to AUTO mode (PIR + LDR control).',
    };
    return { success: true, action: mode, message: descriptions[mode] };
  }
  return result;
}

function toolScheduleRelayAction(args) {
  let mode = args.mode || '';
  mode = mode.trim().toUpperCase();
  const delayMinutes = parseInt(args.delay_minutes || args.delayMinutes, 10);
  console.log(`🔧 Running tool: schedule_relay_action | Mode: ${mode}, Delay: ${delayMinutes} mins`);

  if (!['ON', 'OFF', 'AUTO'].includes(mode)) {
    return { error: `Invalid mode '${mode}'. Must be ON, OFF, or AUTO.` };
  }

  if (isNaN(delayMinutes) || delayMinutes < 1 || delayMinutes > 120) {
    return { error: 'delay_minutes must be an integer between 1 and 120.' };
  }

  const fireAt = new Date(Date.now() + delayMinutes * 60 * 1000);
  // Format firesAt string as HH:MM:SS
  const fireAtStr = String(fireAt.getHours()).padStart(2, '0') + ':' +
    String(fireAt.getMinutes()).padStart(2, '0') + ':' +
    String(fireAt.getSeconds()).padStart(2, '0');

  const executeAction = async () => {
    console.log(`⏰ Scheduled action firing: relay ➔ ${mode}`);
    await mqttClient.publishCommand('home/relay/control', mode);
    // Remove from active timers list
    const index = scheduledTimers.findIndex(t => t.mode === mode && t.fires_at === fireAtStr);
    if (index !== -1) {
      scheduledTimers.splice(index, 1);
    }
  };

  // Node.js setTimeout uses milliseconds
  const timeoutId = setTimeout(executeAction, delayMinutes * 60 * 1000);

  scheduledTimers.push({
    mode,
    fires_at: fireAtStr,
    timeoutId,
  });

  console.log(`⏰ Scheduled relay '${mode}' in ${delayMinutes} min (at ${fireAtStr})`);

  return {
    success: true,
    scheduled_action: mode,
    fires_at: fireAtStr,
    delay_minutes: delayMinutes,
  };
}

// Map tool names to callables
const TOOL_MAP = {
  get_current_sensor_status: toolGetCurrentSensorStatus,
  query_sensor_history: toolQuerySensorHistory,
  set_relay_mode: toolSetRelayMode,
  schedule_relay_action: toolScheduleRelayAction,
};

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL DECLARATIONS (Gemini schema)
// ═══════════════════════════════════════════════════════════════════════════════

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'get_current_sensor_status',
        description: 'Returns the latest live sensor readings from the ESP8266 via MQTT. Use for any question about the CURRENT state: temperature, humidity, light level, motion, or relay status.',
        parameters: {
          type: 'OBJECT',
          properties: {},
        },
      },
      {
        name: 'query_sensor_history',
        description: 'Executes a read-only SELECT query on the sensor_data MySQL table. Use for HISTORICAL or ANALYTICAL questions: energy usage, occupancy patterns, average temperature over time, how long the light was on, etc. Schema: sensor_data(ID, TIMESTAMP, PIR INT, LDR FLOAT, TEMP FLOAT, HUMIDITY FLOAT, RELAY VARCHAR). Only generate SELECT queries — write operations are blocked.',
        parameters: {
          type: 'OBJECT',
          properties: {
            sql_query: {
              type: 'STRING',
              description: 'A valid MySQL SELECT query on the sensor_data table.',
            },
          },
          required: ['sql_query'],
        },
      },
      {
        name: 'set_relay_mode',
        description: 'Controls the smart light relay immediately by publishing to the MQTT broker. Use when the user wants to turn the light ON, OFF, or switch to AUTO mode.',
        parameters: {
          type: 'OBJECT',
          properties: {
            mode: {
              type: 'STRING',
              description: "Relay command. Must be exactly 'ON', 'OFF', or 'AUTO'.",
            },
          },
          required: ['mode'],
        },
      },
      {
        name: 'schedule_relay_action',
        description: 'Schedules a relay command to execute after a specified delay in minutes. Use for time-based commands like \'turn off the light in 10 minutes\' or \'switch to AUTO mode in half an hour\'.',
        parameters: {
          type: 'OBJECT',
          properties: {
            mode: {
              type: 'STRING',
              description: "Relay command to schedule: 'ON', 'OFF', or 'AUTO'.",
            },
            delay_minutes: {
              type: 'INTEGER',
              description: 'Number of minutes to wait before executing (1-120).',
            },
          },
          required: ['mode', 'delay_minutes'],
        },
      },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `
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
`.trim();

// ═══════════════════════════════════════════════════════════════════════════════
// AGENTIC LOOP
// ═══════════════════════════════════════════════════════════════════════════════

export async function run(userMessage) {
  console.log(`🤖 Agent received user message: "${userMessage}"`);

  // Build the conversation history starting with the user's message
  const contents = [
    { role: 'user', parts: [{ text: userMessage }] }
  ];

  const maxTurns = 8;
  for (let turn = 0; turn < maxTurns; turn++) {
    console.log(`🔄 Agent loop turn ${turn + 1}/${maxTurns}`);

    let response;
    try {
      response = await ai.models.generateContent({
        model: MODEL,
        contents: contents,
        config: {
          tools: TOOLS,
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.2, // Lower = more deterministic/factual
        },
      });
    } catch (e) {
      console.error(`❌ Gemini API error: ${e.message}`);
      return `I encountered an error communicating with the AI model: ${e.message}`;
    }

    const candidate = response.candidates?.[0];
    if (!candidate || !candidate.content) {
      console.error('❌ Empty response from Gemini API');
      return 'I encountered an empty response from the AI model.';
    }

    const modelContent = candidate.content;
    contents.push(modelContent);

    // Filter parts to extract function calls
    const functionCallParts = modelContent.parts?.filter(part => part.functionCall) || [];

    // No function calls ➔ Gemini has a final text answer
    if (functionCallParts.length === 0) {
      const textParts = modelContent.parts?.filter(part => part.text).map(part => part.text) || [];
      const finalAnswer = textParts.join(' ').trim();
      console.log(`✅ Agent final answer (${finalAnswer.length} chars)`);
      return finalAnswer || 'I completed the action but have no further response.';
    }

    // Execute all tool calls
    const functionResponseParts = [];

    for (const part of functionCallParts) {
      const fc = part.functionCall;
      const toolName = fc.name;
      const toolArgs = fc.args ? { ...fc.args } : {};

      console.log(`🔧 Tool call requested: ${toolName}(${JSON.stringify(toolArgs)})`);

      const toolFn = TOOL_MAP[toolName];
      let toolResult;

      if (toolFn) {
        try {
          // Await in case it returns a promise (like DB/MQTT calls)
          toolResult = await toolFn(toolArgs);
        } catch (e) {
          toolResult = { error: `Tool ${toolName} failed: ${e.message}` };
        }
      } else {
        toolResult = { error: `Unknown tool '${toolName}'. This should not happen.` };
      }

      console.log(`📦 Tool result for ${toolName}: ${JSON.stringify(toolResult).slice(0, 200)}`);

      // Package the result to send back to Gemini
      functionResponseParts.push({
        functionResponse: {
          name: toolName,
          response: typeof toolResult === 'object' ? toolResult : { result: toolResult }
        }
      });
    }

    // Add all tool results to the conversation history as a "user" turn
    contents.push({
      role: 'user',
      parts: functionResponseParts
    });
  }

  console.warn(`⚠️ Agent hit max turn limit (${maxTurns}). Returning fallback.`);
  return 'I was processing your request but reached the maximum reasoning steps. Please try rephrasing your question.';
}
