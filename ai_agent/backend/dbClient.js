import mysql from 'mysql2/promise';
import { MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB } from './config.js';

let pool = null;

export async function initPool() {
  try {
    pool = mysql.createPool({
      host: MYSQL_HOST,
      port: MYSQL_PORT,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      database: MYSQL_DB,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      connectTimeout: 5000,
    });
    console.log(`✅ MySQL connection pool created for database '${MYSQL_DB}'`);
    await verifySchema();
  } catch (error) {
    console.error(`❌ MySQL pool creation failed: ${error.message}`);
    pool = null; // Proceed without crashing server
  }
}

async function verifySchema() {
  try {
    const result = await rawQuery('DESCRIBE sensor_data');
    const columns = result.map(row => row.Field);
    console.log(`📋 sensor_data columns: ${columns.join(', ')}`);
  } catch (error) {
    console.warn(`⚠️  Could not verify schema: ${error.message}`);
  }
}

async function rawQuery(sql, params = []) {
  if (!pool) {
    throw new Error('Database pool is not initialized.');
  }
  const [rows] = await pool.execute(sql, params);
  return rows;
}

export async function runReadQuery(sql) {
  // ── Security check ────────────────────────────────────────────────────────
  const normalized = sql.trim().toUpperCase();
  const forbidden = ["INSERT", "UPDATE", "DELETE", "DROP", "TRUNCATE", "ALTER", "CREATE"];

  if (!normalized.startsWith("SELECT")) {
    return {
      success: false,
      error: "Only SELECT queries are permitted. Write operations are blocked."
    };
  }

  for (const keyword of forbidden) {
    if (normalized.includes(keyword)) {
      return {
        success: false,
        error: `Forbidden keyword '${keyword}' detected. Query rejected.`
      };
    }
  }

  // ── Execute ───────────────────────────────────────────────────────────────
  try {
    const rows = await rawQuery(sql);

    // Convert Date objects to formatted strings for clean JSON serialization
    const serializableRows = rows.map(row => {
      const newRow = {};
      for (const [key, val] of Object.entries(row)) {
        if (val instanceof Date) {
          // Format date as YYYY-MM-DD HH:MM:SS
          newRow[key] = val.toISOString().slice(0, 19).replace('T', ' ');
        } else {
          newRow[key] = val;
        }
      }
      return newRow;
    });

    console.log(`📊 Query returned ${serializableRows.length} rows: ${sql.slice(0, 80)}`);
    return {
      success: true,
      rows: serializableRows,
      count: serializableRows.length
    };
  } catch (error) {
    console.error(`❌ MySQL query error: ${error.message} | SQL: ${sql}`);
    return {
      success: false,
      error: `Query failed: ${error.message}`
    };
  }
}
