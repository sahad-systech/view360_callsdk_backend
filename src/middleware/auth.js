const User = require("../models/user");
const view = require("../views/json");

function parseTokenPayload(token) {
  if (!token) return null;
  // If the token is a JWT, parse the payload claims
  if (token.includes(".")) {
    const parts = token.split(".");
    if (parts.length === 3) {
      try {
        const payloadStr = Buffer.from(parts[1], "base64url").toString("utf8");
        const payload = JSON.parse(payloadStr);
        return payload.sub || payload.identity || payload.userId || payload.id || null;
      } catch {
        return null;
      }
    }
  }
  // Otherwise treat the token string directly as the user ID or username
  return token.trim();
}

async function authenticate(req, res, next) {
  try {
    let callerId = null;

    // 1. Check Authorization header: Bearer <token-or-userId>
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.trim().toLowerCase().startsWith("bearer ")) {
      const rawToken = authHeader.trim().substring(7).trim();
      callerId = parseTokenPayload(rawToken);
    }

    // 2. Fallback to x-user-id header if Authorization is not present
    if (!callerId && req.headers["x-user-id"]) {
      callerId = String(req.headers["x-user-id"]).trim();
    }

    if (!callerId) {
      return res.status(401).json(view.apiError("Unauthorized: Missing authentication credentials"));
    }

    // 3. Verify user exists in the database
    const user = await User.findById(callerId);
    if (!user) {
      return res.status(401).json(view.apiError("Unauthorized: User not found"));
    }

    // 4. Attach verified user to the request
    req.user = user;
    return next();
  } catch (error) {
    if (error.code === "ECONNREFUSED") {
      console.error("Database connection refused. Ensure PostgreSQL is running on the host/port configured in .env.");
      return res.status(500).json(view.apiError("Database connection refused. Ensure PostgreSQL is running and .env is configured."));
    }
    console.error("Authentication middleware error:", error);
    return res.status(500).json(view.apiError("Authentication server error"));
  }
}

module.exports = authenticate;
