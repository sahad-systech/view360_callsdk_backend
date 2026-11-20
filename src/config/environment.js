const path = require("node:path");

const envPath = process.env.DOTENV_CONFIG_PATH || path.resolve(__dirname, "../../.env");
require("dotenv").config({ path: envPath });

const { PORT = 3000, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = process.env;

const missing = [];
if (!LIVEKIT_API_KEY) missing.push("LIVEKIT_API_KEY");
if (!LIVEKIT_API_SECRET) missing.push("LIVEKIT_API_SECRET");
if (!LIVEKIT_URL) missing.push("LIVEKIT_URL");

if (missing.length > 0) {
  throw new Error(`Missing LiveKit environment variables: ${missing.join(", ")}`);
}

module.exports = {
  port: PORT,
  livekit: { apiKey: LIVEKIT_API_KEY, apiSecret: LIVEKIT_API_SECRET, url: LIVEKIT_URL },
};
