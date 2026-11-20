const crypto = require("node:crypto");
const Call = require("../models/call");
const User = require("../models/user");
const Token = require("../models/token");
const view = require("../views/json");

async function initiate(req, res) {
  try {
    // 1. Caller ID must come from the authenticated user, never from request body
    const callerId = req.user?.id;
    if (!callerId) {
      return res.status(401).json(view.apiError("Unauthorized"));
    }

    // 2. Validate receiverId
    const { receiverId } = req.body || {};
    if (!receiverId || typeof receiverId !== "string" || !receiverId.trim()) {
      return res.status(400).json(view.apiError("receiverId is required"));
    }

    const trimmedReceiverId = receiverId.trim();

    // 3. Prevent calling oneself
    if (
      callerId === trimmedReceiverId ||
      req.user?.name === trimmedReceiverId ||
      req.user?.email === trimmedReceiverId
    ) {
      return res.status(400).json(view.apiError("You cannot call yourself"));
    }

    // 4. Verify receiver exists in database
    const receiver = await User.findById(trimmedReceiverId);
    if (!receiver) {
      return res.status(404).json(view.apiError("Receiver not found"));
    }

    if (callerId === receiver.id) {
      return res.status(400).json(view.apiError("You cannot call yourself"));
    }

    // 5. Generate unique call ID and LiveKit room name
    const callId = crypto.randomUUID();
    const roomName = `call-${callId}`;

    // 6. Insert new call record with status 'ringing'
    const call = await Call.create({
      id: callId,
      callerId,
      receiverId: receiver.id,
      roomName,
      status: "ringing",
    });

    // 7. Return call information
    return res.status(200).json(view.callInitiated(call));
  } catch (error) {
    if (error.code === "ECONNREFUSED") {
      console.error("Database connection refused. Ensure PostgreSQL is running on the host/port configured in .env.");
      return res.status(500).json(view.apiError("Database connection refused. Ensure PostgreSQL is running and .env is configured."));
    }
    console.error("Call initiation failed:", error);
    return res.status(500).json(view.apiError("Internal server error"));
  }
}

async function accept(req, res) {
  try {
    // 1. Authenticate the receiver from req.user
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return res.status(401).json(view.apiError("Unauthorized"));
    }

    // 2. Validate callId
    const { callId } = req.body || {};
    if (!callId || typeof callId !== "string" || !callId.trim()) {
      return res.status(400).json(view.apiError("callId is required"));
    }

    const trimmedCallId = callId.trim();

    // 3. Find the call
    const call = await Call.findById(trimmedCallId);
    if (!call) {
      return res.status(404).json(view.apiError("Call not found"));
    }

    // 4. Security checks: only the intended receiver can accept
    if (call.callerId === currentUserId) {
      return res.status(403).json(view.apiError("Caller cannot accept their own call"));
    }

    if (call.receiverId !== currentUserId) {
      return res.status(403).json(view.apiError("Only the intended receiver can accept this call"));
    }

    // 5. Status check: call must be 'ringing'
    if (call.status !== "ringing") {
      return res.status(400).json(view.apiError(`Call cannot be accepted because it is already ${call.status}`));
    }

    // 6. Check ringing timeout if configured
    const ringingTimeoutSeconds = parseInt(process.env.RINGING_TIMEOUT_SECONDS || "0", 10);
    if (ringingTimeoutSeconds > 0 && call.createdAt) {
      const callAgeMs = Date.now() - new Date(call.createdAt).getTime();
      if (callAgeMs > ringingTimeoutSeconds * 1000) {
        return res.status(400).json(view.apiError("Call has expired"));
      }
    }

    // 7. Atomically update call status to 'accepted' and set started_at
    const updatedCall = await Call.accept({ id: trimmedCallId, receiverId: currentUserId });
    if (!updatedCall) {
      return res.status(409).json(view.apiError("Call is no longer available to accept"));
    }

    // 8. Generate separate LiveKit tokens for caller and receiver in the same room
    const [callerToken, receiverToken] = await Promise.all([
      Token.create({
        roomName: updatedCall.roomName,
        participantName: updatedCall.callerId,
      }),
      Token.create({
        roomName: updatedCall.roomName,
        participantName: updatedCall.receiverId,
      }),
    ]);

    // 9. Return accepted call data
    return res.status(200).json(
      view.callAccepted({
        call: updatedCall,
        serverUrl: callerToken.serverUrl,
        caller: {
          participantName: callerToken.participantName,
          token: callerToken.token,
        },
        receiver: {
          participantName: receiverToken.participantName,
          token: receiverToken.token,
        },
      })
    );
  } catch (error) {
    console.error("Call acceptance failed:", error);
    return res.status(500).json(view.apiError("Internal server error"));
  }
}

module.exports = { initiate, accept };
