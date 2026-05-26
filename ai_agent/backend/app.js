import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import * as mqttClient from './mqttClient.js';
import * as dbClient from './dbClient.js';
import * as agent from './agent.js';

const app = express();
const PORT = process.env.PORT || 8000;

// Resolve filenames for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Enable CORS
app.use(cors({
  origin: '*',
  methods: '*',
  allowedHeaders: '*'
}));

// Parse application/json
app.use(express.json());

// ── REST API Endpoints ─────────────────────────────────────────────────────────────

// GET /api/status - Live sensor readings
app.get('/api/status', (req, res) => {
  res.json(mqttClient.latestSensorData);
});

// POST /api/chat - Chat with AI Agent
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Missing required field: message' });
  }

  console.log(`💬 Chat: ${message}`);
  try {
    const responseText = await agent.run(message);
    res.json({ response: responseText });
  } catch (error) {
    console.error(`❌ Chat handler error: ${error.message}`);
    res.status(500).json({ error: 'An error occurred while processing the agent request.' });
  }
});

// GET /api/scheduled - List pending scheduled actions
app.get('/api/scheduled', (req, res) => {
  const safeTimers = agent.scheduledTimers.map(t => ({
    mode: t.mode,
    fires_at: t.fires_at
  }));
  res.json({
    scheduled: safeTimers,
    count: safeTimers.length
  });
});

// ── Static File Serving ───────────────────────────────────────────────────────
// Serve frontend at / — this must come AFTER API routes are defined
// so /api/* routes take priority over static file matching.
const frontendPath = path.join(__dirname, '..', 'frontend');

if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
  console.log(`🌐 Frontend served from: ${path.resolve(frontendPath)}`);
} else {
  console.warn(`⚠️  Frontend directory not found at ${frontendPath} — skipping static mount.`);
}

// Startup lifecycle
async function main() {
  console.log('🚀 Server starting up...');
  
  // Start MQTT client (runs in background event loop)
  mqttClient.start();
  
  // Initialize MySQL Connection Pool
  await dbClient.initPool();

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`⚡ LumaAgent Node.js API running at http://localhost:${PORT}`);
  });

  // Graceful shutdown handling
  const shutdown = () => {
    console.log('\n🛑 Server shutting down...');
    mqttClient.stop();
    server.close(() => {
      console.log('💤 Server connection closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => {
  console.error('❌ Server startup failed:', err);
  process.exit(1);
});
