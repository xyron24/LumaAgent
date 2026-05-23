CREATE TABLE sensor_data (
  TIMESTAMP DATETIME DEFAULT CURRENT_TIMESTAMP,
  TEMP      FLOAT,
  HUMIDITY  FLOAT,      -- Fixed: was HUM, matches Node-RED insertion code
  LDR       FLOAT,
  PIR       INT,
  RELAY     VARCHAR(10)
);