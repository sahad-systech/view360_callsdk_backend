const { AccessToken } = require("livekit-server-sdk");
const { livekit } = require("../config/environment");

async function create({ roomName, participantName }) {
  const token = new AccessToken(livekit.apiKey, livekit.apiSecret, {
    identity: participantName,
    ttl: "1h",
  });

  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return {
    serverUrl: livekit.url,
    participantName,
    roomName,
    token: await token.toJwt(),
  };
}

module.exports = { create };
