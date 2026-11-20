const db = require("../src/config/database");

async function testConnection() {
  console.log("Testing PostgreSQL connection...");
  try {
    const res = await db.query("SELECT NOW() as current_time, current_database() as database;");
    console.log(" Connection successful!");
    console.log(`Connected to database: ${res.rows[0].database}`);
    console.log(`Server time: ${res.rows[0].current_time}`);
  } catch (error) {
    console.error(" Connection failed!");
    if (error.code === "ECONNREFUSED") {
      console.error(`Error: Could not connect to PostgreSQL on ${error.address || "127.0.0.1"}:${error.port || 5432}.`);
      console.error("Make sure your PostgreSQL server is started, or update the credentials/DATABASE_URL in .env.");
    } else {
      console.error(error.message);
    }
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

testConnection();
