const Token = require("../models/token");
const view = require("../views/json");

async function create(req, res) {
  try {
    const { roomName, participantName } = req.body || {};
    if (!roomName || !participantName) {
      return res.status(400).json(view.error("roomName and participantName are required"));
    }

    const token = await Token.create({ roomName, participantName });
    return res.json(view.token(token));
  } catch (error) {
    console.error("Token generation failed:", error);
    return res.status(500).json(view.error("Token generation failed"));
  }
}

module.exports = { create };
