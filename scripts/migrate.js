const fs = require("node:fs");
const path = require("node:path");
const db = require("../src/config/database");

async function runMigration() {
  const migrationsDir = path.join(__dirname, "../migrations");
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

  console.log(`Found ${files.length} migration file(s) in ${migrationsDir}`);

  try {
    for (const file of files) {
      const migrationPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(migrationPath, "utf-8");
      console.log(`Running migration: ${file} ...`);
      await db.query(sql);
      console.log(`Migration ${file} executed successfully!`);
    }
    console.log("All migrations executed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

runMigration();
