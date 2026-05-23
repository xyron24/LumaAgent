"""
db_client.py
------------
Dedicated MySQL client module with connection pooling.

- Uses a connection pool for efficient, concurrent database access.
- run_read_query() is the ONLY way the agent reads from the database.
- SQL injection protection: rejects any query that is not a SELECT statement.
- Schema verification: logs actual column names on startup to catch mismatches.
- Graceful error handling: returns {"error": ...} dicts instead of crashing.
"""

import logging
import mysql.connector
from mysql.connector import pooling, Error

from config import MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB

logger = logging.getLogger(__name__)

# ── Connection Pool ───────────────────────────────────────────────────────────
_pool: pooling.MySQLConnectionPool | None = None


def init_pool():
    """
    Create the MySQL connection pool on server startup.
    Also runs schema verification to catch column name mismatches early.
    """
    global _pool
    try:
        _pool = pooling.MySQLConnectionPool(
            pool_name="iot_pool",
            pool_size=5,
            host=MYSQL_HOST,
            port=MYSQL_PORT,
            user=MYSQL_USER,
            password=MYSQL_PASSWORD,
            database=MYSQL_DB,
            connection_timeout=5,
        )
        logger.info("✅ MySQL connection pool created for database '%s'", MYSQL_DB)
        _verify_schema()

    except Error as e:
        # Do NOT raise — server starts even if MySQL is temporarily down
        logger.error("❌ MySQL pool creation failed: %s", e)
        _pool = None


def _verify_schema():
    """
    Log the actual columns in sensor_data.
    Catches schema mismatches (e.g. HUM vs HUMIDITY) immediately at startup.
    """
    try:
        result = _raw_query("DESCRIBE sensor_data")
        columns = [row["Field"] for row in result]
        logger.info("📋 sensor_data columns: %s", columns)
    except Exception as e:
        logger.warning("⚠️  Could not verify schema: %s", e)


def _raw_query(sql: str, params: tuple = ()) -> list[dict]:
    """Internal: execute any SQL and return rows as list of dicts."""
    if _pool is None:
        raise ConnectionError("Database pool is not initialized.")

    conn = _pool.get_connection()
    try:
        cursor = conn.cursor(dictionary=True)
        cursor.execute(sql, params)
        return cursor.fetchall()
    finally:
        cursor.close()
        conn.close()


# ── Public API ────────────────────────────────────────────────────────────────

def run_read_query(sql: str) -> dict:
    """
    Execute a read-only SELECT query and return results.

    Security guardrail: Rejects any SQL that is not a SELECT statement.
    This prevents the LLM from accidentally (or maliciously via prompt injection)
    issuing INSERT, UPDATE, DELETE, or DROP commands.

    Returns:
        {"success": True,  "rows": [...], "count": N}  on success
        {"success": False, "error": "..."}              on failure
    """
    # ── Security check ────────────────────────────────────────────────────────
    normalized = sql.strip().upper()
    forbidden = ["INSERT", "UPDATE", "DELETE", "DROP", "TRUNCATE", "ALTER", "CREATE"]
    if not normalized.startswith("SELECT"):
        return {
            "success": False,
            "error": "Only SELECT queries are permitted. Write operations are blocked.",
        }
    for keyword in forbidden:
        if keyword in normalized:
            return {
                "success": False,
                "error": f"Forbidden keyword '{keyword}' detected. Query rejected.",
            }

    # ── Execute ───────────────────────────────────────────────────────────────
    try:
        rows = _raw_query(sql)
        # Convert datetime objects to strings for JSON serialization
        serializable_rows = []
        for row in rows:
            serializable_rows.append({
                k: str(v) if hasattr(v, "isoformat") else v
                for k, v in row.items()
            })
        logger.info("📊 Query returned %d rows: %s", len(serializable_rows), sql[:80])
        return {"success": True, "rows": serializable_rows, "count": len(serializable_rows)}

    except ConnectionError as e:
        logger.error("❌ DB connection error: %s", e)
        return {"success": False, "error": "Database is unavailable right now."}

    except Error as e:
        logger.error("❌ MySQL query error: %s | SQL: %s", e, sql)
        return {"success": False, "error": f"Query failed: {str(e)}"}

    except Exception as e:
        logger.error("❌ Unexpected DB error: %s", e)
        return {"success": False, "error": "An unexpected database error occurred."}
