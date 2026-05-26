import mqtt from 'mqtt';
import { MQTT_BROKER, MQTT_PORT } from './config.js';

export const latestSensorData = {
  temp: null,
  humidity: null,
  ldr: null,
  pir: null,
  relay: null,
  mqtt_connected: false,
};

let client = null;

export function start() {
  try {
    const brokerUrl = `mqtt://${MQTT_BROKER}:${MQTT_PORT}`;
    console.log(`🔌 MQTT client starting. Connecting to ${brokerUrl}...`);

    client = mqtt.connect(brokerUrl, {
      clientId: 'IoT_AI_Agent_Server_Node',
      clean: true,
      connectTimeout: 5000,
      reconnectPeriod: 5000,
    });

    client.on('connect', () => {
      console.log(`✅ MQTT connected to ${MQTT_BROKER}:${MQTT_PORT}`);
      latestSensorData.mqtt_connected = true;

      // Subscribe to all sensor topics
      client.subscribe([
        'home/ldr',
        'home/pir',
        'home/dht',
        'home/relay'
      ], { qos: 2 }, (err) => {
        if (err) {
          console.error('❌ MQTT subscription error:', err);
        }
      });
    });

    client.on('offline', () => {
      console.warn('⚠️  MQTT client offline. Attempting reconnect...');
      latestSensorData.mqtt_connected = false;
    });

    client.on('close', () => {
      latestSensorData.mqtt_connected = false;
    });

    client.on('error', (err) => {
      console.error('❌ MQTT client error:', err.message);
      latestSensorData.mqtt_connected = false;
    });

    client.on('message', (topic, message) => {
      const payload = message.toString().trim();

      try {
        if (topic === 'home/ldr') {
          latestSensorData.ldr = Math.round(parseFloat(payload) * 100) / 100;
        } else if (topic === 'home/pir') {
          latestSensorData.pir = parseInt(payload, 10);
        } else if (topic === 'home/dht') {
          const data = JSON.parse(payload);
          latestSensorData.temp = Math.round(parseFloat(data.temp || 0) * 100) / 100;
          latestSensorData.humidity = Math.round(parseFloat(data.hum || 0) * 100) / 100;
        } else if (topic === 'home/relay') {
          latestSensorData.relay = payload; // "ON" or "OFF"
        }
      } catch (err) {
        console.error(`❌ Failed to parse message on ${topic}: ${payload} | Error: ${err.message}`);
      }
    });

  } catch (error) {
    console.error(`❌ MQTT client failed to start: ${error.message}`);
    latestSensorData.mqtt_connected = false;
  }
}

export function stop() {
  if (client) {
    client.end(false, () => {
      console.log('🔌 MQTT client cleanly disconnected.');
    });
    latestSensorData.mqtt_connected = false;
  }
}

export function publishCommand(topic, message) {
  if (!client || !latestSensorData.mqtt_connected) {
    return { success: false, error: 'MQTT broker is not connected. Command not sent.' };
  }

  return new Promise((resolve) => {
    client.publish(topic, message, { qos: 1 }, (err) => {
      if (err) {
        console.error(`❌ Publish error: ${err.message}`);
        resolve({ success: false, error: err.message });
      } else {
        console.log(`📤 Published '${message}' to '${topic}'`);
        resolve({ success: true, topic, message });
      }
    });
  });
}
