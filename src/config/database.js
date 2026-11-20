const { Pool } = require("pg");
const path = require("node:path");

const envPath = process.env.DOTENV_CONFIG_PATH || path.resolve(__dirname, "../../.env");
require("dotenv").config({ path: envPath });

const poolConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.DB_HOST || process.env.PGHOST || "localhost",
      port: parseInt(process.env.DB_PORT || process.env.PGPORT || "5432", 10),
      user: process.env.DB_USER || process.env.PGUSER || "postgres",
      password: process.env.DB_PASSWORD || process.env.PGPASSWORD || "",
      database: process.env.DB_NAME || process.env.PGDATABASE || "view360",
    };

if (process.env.DB_SSL === "true" || process.env.DATABASE_SSL === "true") {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

pool.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client", err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
