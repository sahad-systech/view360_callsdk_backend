const firebase = require("../config/firebase");
const FcmToken = require("../models/fcmToken");

const INVALID_TOKEN_ERROR_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
  "messaging/invalid-argument",
]);

async function sendIncomingCallNotification(receiverId, callData) {
  try {
    if (!receiverId) {
      return { success: false, reason: "receiverId is required" };
    }

    // 1. Retrieve all registered FCM tokens for the receiver
    const tokenRecords = await FcmToken.findByUserId(receiverId);
    if (!tokenRecords || tokenRecords.length === 0) {
      console.log(`[NotificationService] No FCM tokens registered for receiver ${receiverId}`);
      return {
        success: true,
        sentCount: 0,
        failureCount: 0,
        message: "No registered devices for receiver",
      };
    }

    // Extract raw token strings
    const tokens = tokenRecords.map((t) => t.fcmToken).filter(Boolean);
    if (tokens.length === 0) {
      return {
        success: true,
        sentCount: 0,
        failureCount: 0,
        message: "No valid tokens found",
      };
    }

    // 2. Check if Firebase messaging service is available
    const messaging = firebase.getMessagingService();
    if (!messaging) {
      console.warn("[NotificationService] Firebase is not initialized. Notification skipped.");
      return {
        success: false,
        reason: "Firebase messaging service not configured",
      };
    }

    // 3. Construct payload strictly with string values
    const dataPayload = {
      type: "incoming_call",
      callId: String(callData.callId || ""),
      callerId: String(callData.callerId || ""),
      callerName: String(callData.callerName || ""),
      receiverId: String(callData.receiverId || ""),
      roomName: String(callData.roomName || ""),
      timestamp: String(callData.createdAt || new Date().toISOString()),
    };

    const multicastMessage = {
      tokens,
      data: dataPayload,
      android: {
        priority: "high",
        ttl: 60 * 1000, // 60 seconds
      },
      apns: {
        headers: {
          "apns-priority": "10",
          "apns-push-type": "background",
        },
        payload: {
          aps: {
            "content-available": 1,
          },
        },
      },
    };

    // 4. Send multicast message
    const response = await messaging.sendEachForMulticast(multicastMessage);

    const tokensToRemove = [];
    if (response && Array.isArray(response.responses)) {
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error) {
          console.warn(
            `[NotificationService] Failed to send to token: ${resp.error.code} - ${resp.error.message}`
          );
          if (INVALID_TOKEN_ERROR_CODES.has(resp.error.code)) {
            tokensToRemove.push(tokens[idx]);
          }
        }
      });
    }

    // 5. Clean up invalid/expired tokens from DB
    if (tokensToRemove.length > 0) {
      try {
        await FcmToken.deleteMultipleTokens(tokensToRemove);
        console.log(`[NotificationService] Cleaned up ${tokensToRemove.length} invalid/expired tokens.`);
      } catch (cleanupError) {
        console.error("[NotificationService] Error cleaning up invalid tokens:", cleanupError);
      }
    }

    return {
      success: true,
      sentCount: response.successCount,
      failureCount: response.failureCount,
    };
  } catch (error) {
    console.error("[NotificationService] Error sending incoming call notification:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

module.exports = {
  sendIncomingCallNotification,
  INVALID_TOKEN_ERROR_CODES,
};
