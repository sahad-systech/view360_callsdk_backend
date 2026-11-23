const crypto = require("node:crypto");
const Call = require("../models/call");
const User = require("../models/user");
const Token = require("../models/token");
const notificationService = require("../services/notificationService");
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

    // 7. Send incoming call notification via FCM (best-effort, non-blocking)
    try {
      await notificationService.sendIncomingCallNotification(receiver.id, {
        callId: call.callId,
        callerId: call.callerId,
        callerName: req.user?.name,
        receiverId: call.receiverId,
        roomName: call.roomName,
        createdAt: call.createdAt,
      });
    } catch (notifError) {
      console.error("Failed to send incoming call FCM notification:", notifError);
    }

    // 8. Return call information
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
    if (error.code === "ECONNREFUSED") {
      console.error("Database connection refused. Ensure PostgreSQL is running on the host/port configured in .env.");
      return res.status(500).json(view.apiError("Database connection refused. Ensure PostgreSQL is running and .env is configured."));
    }
    console.error("Call acceptance failed:", error);
    return res.status(500).json(view.apiError("Internal server error"));
  }
}

async function reject(req, res) {
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

    // 4. Security checks: only the intended receiver can reject
    if (call.callerId === currentUserId) {
      return res.status(403).json(view.apiError("Caller cannot reject their own call"));
    }

    if (call.receiverId !== currentUserId) {
      return res.status(403).json(view.apiError("Only the intended receiver can reject this call"));
    }

    // 5. Status check: call must be 'ringing'
    if (call.status !== "ringing") {
      return res.status(400).json(view.apiError(`Call cannot be rejected because it is already ${call.status}`));
    }

    // 6. Atomically update call status to 'rejected' and set ended_at
    const updatedCall = await Call.reject({ id: trimmedCallId, receiverId: currentUserId });
    if (!updatedCall) {
      return res.status(409).json(view.apiError("Call is no longer available to reject"));
    }

    // 7. Return success response
    return res.status(200).json(view.callRejected(updatedCall));
  } catch (error) {
    if (error.code === "ECONNREFUSED") {
      console.error("Database connection refused. Ensure PostgreSQL is running on the host/port configured in .env.");
      return res.status(500).json(view.apiError("Database connection refused. Ensure PostgreSQL is running and .env is configured."));
    }
    console.error("Call rejection failed:", error);
    return res.status(500).json(view.apiError("Internal server error"));
  }
}

async function endCall(req, res) {
  try {
    // 1. Authenticate user from req.user
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

    // 4. Authorization check: only caller or receiver can end it
    if (call.callerId !== currentUserId && call.receiverId !== currentUserId) {
      return res.status(403).json(view.apiError("Only call participants can end this call"));
    }

    // 5. Status check: verify that call is currently 'accepted'
    if (call.status !== "accepted") {
      return res.status(400).json(view.apiError(`Call cannot be ended because it is ${call.status}`));
    }

    // 6. Atomically update status to 'ended' and set ended_at
    const updatedCall = await Call.end({ id: trimmedCallId, userId: currentUserId });
    if (!updatedCall) {
      return res.status(409).json(view.apiError("Call state was updated by another request"));
    }

    // 7. Return updated call information including duration
    return res.status(200).json(view.callEnded(updatedCall));
  } catch (error) {
    if (error.code === "ECONNREFUSED") {
      console.error("Database connection refused. Ensure PostgreSQL is running on the host/port configured in .env.");
      return res.status(500).json(view.apiError("Database connection refused. Ensure PostgreSQL is running and .env is configured."));
    }
    console.error("Call ending failed:", error);
    return res.status(500).json(view.apiError("Internal server error"));
  }
}

async function getDetails(req, res) {
  try {
    // 1. Authenticate user from req.user
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return res.status(401).json(view.apiError("Unauthorized"));
    }

    // 2. Validate callId from URL parameter
    const { callId } = req.params || {};
    if (!callId || typeof callId !== "string" || !callId.trim()) {
      return res.status(400).json(view.apiError("callId is required"));
    }

    const trimmedCallId = callId.trim();

    // 3. Find the call
    const call = await Call.findById(trimmedCallId);
    if (!call) {
      return res.status(404).json(view.apiError("Call not found"));
    }

    // 4. Authorization check: only caller or receiver can access the call
    if (call.callerId !== currentUserId && call.receiverId !== currentUserId) {
      return res.status(403).json(view.apiError("Access denied: You are not a participant in this call"));
    }

    // 5. Return call details without exposing secrets
    return res.status(200).json(view.callDetails(call));
  } catch (error) {
    if (error.code === "ECONNREFUSED") {
      console.error("Database connection refused. Ensure PostgreSQL is running on the host/port configured in .env.");
      return res.status(500).json(view.apiError("Database connection refused. Ensure PostgreSQL is running and .env is configured."));
    }
    console.error("Get call details failed:", error);
    return res.status(500).json(view.apiError("Internal server error"));
  }
}

async function getHistory(req, res) {
  try {
    // 1. Authenticate user from req.user
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return res.status(401).json(view.apiError("Unauthorized"));
    }

    // 2. Validate pagination parameters
    let page = 1;
    let limit = 20;

    if (req.query.page !== undefined) {
      const parsedPage = parseInt(req.query.page, 10);
      if (isNaN(parsedPage) || parsedPage < 1) {
        return res.status(400).json(view.apiError("page must be a positive integer"));
      }
      page = parsedPage;
    }

    if (req.query.limit !== undefined) {
      const parsedLimit = parseInt(req.query.limit, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
        return res.status(400).json(view.apiError("limit must be a positive integer between 1 and 100"));
      }
      limit = parsedLimit;
    }

    // 3. Fetch call history scoped to authenticated user
    const history = await Call.findHistory({ userId: currentUserId, page, limit });

    // 4. Return history with pagination metadata
    return res.status(200).json(view.callHistory(history));
  } catch (error) {
    if (error.code === "ECONNREFUSED") {
      console.error("Database connection refused. Ensure PostgreSQL is running on the host/port configured in .env.");
      return res.status(500).json(view.apiError("Database connection refused. Ensure PostgreSQL is running and .env is configured."));
    }
    console.error("Get call history failed:", error);
    return res.status(500).json(view.apiError("Internal server error"));
  }
}

async function cancel(req, res) {
  try {
    // 1. Authenticate caller from req.user
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

    // 4. Authorization check: only the caller can cancel
    if (call.callerId !== currentUserId) {
      return res.status(403).json(view.apiError("Only the caller can cancel this call"));
    }

    // 5. Status check: verify that call is still 'ringing'
    if (call.status !== "ringing") {
      return res.status(400).json(view.apiError(`Call cannot be cancelled because it is already ${call.status}`));
    }

    // 6. Atomically update status to 'cancelled' and set ended_at
    const updatedCall = await Call.cancel({ id: trimmedCallId, callerId: currentUserId });
    if (!updatedCall) {
      return res.status(409).json(view.apiError("Call is no longer available to cancel"));
    }

    // 7. Return success response
    return res.status(200).json(view.callCancelled(updatedCall));
  } catch (error) {
    if (error.code === "ECONNREFUSED") {
      console.error("Database connection refused. Ensure PostgreSQL is running on the host/port configured in .env.");
      return res.status(500).json(view.apiError("Database connection refused. Ensure PostgreSQL is running and .env is configured."));
    }
    console.error("Call cancellation failed:", error);
    return res.status(500).json(view.apiError("Internal server error"));
  }
}

module.exports = {
  initiate,
  accept,
  reject,
  endCall,
  getDetails,
  getHistory,
  cancel,
};
