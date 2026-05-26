import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
export const MYSQL_HOST = process.env.MYSQL_HOST || '127.0.0.1';
export const MYSQL_PORT = parseInt(process.env.MYSQL_PORT || '3306', 10);
export const MYSQL_USER = process.env.MYSQL_USER || 'root';
export const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || '';
export const MYSQL_DB = process.env.MYSQL_DB || 'home_automation';

export const MQTT_BROKER = process.env.MQTT_BROKER || 'dev.coppercloud.in';
export const MQTT_PORT = parseInt(process.env.MQTT_PORT || '1883', 10);

if (!GEMINI_API_KEY) {
  console.warn('⚠️  Warning: GEMINI_API_KEY is not set in the environment variables. Please add it to your .env file.');
}
