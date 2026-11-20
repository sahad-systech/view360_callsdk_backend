const fs = require("node:fs");
const path = require("node:path");
const db = require("../src/config/database");

async function runMigration() {
  const migrationPath = path.join(__dirname, "../migrations/001_create_calls_table.sql");
  const sql = fs.readFileSync(migrationPath, "utf-8");

  console.log("Running migration: 001_create_calls_table.sql ...");
  try {
    await db.query(sql);
    console.log("Migration executed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

runMigration();
