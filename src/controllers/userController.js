const FcmToken = require("../models/fcmToken");
const User = require("../models/user");
const view = require("../views/json");

async function registerFcmToken(req, res) {
  try {
    const { userId: bodyUserId, user_id, fcmToken, deviceType, deviceId } = req.body || {};
    const candidateUserId = req.user?.id || bodyUserId || user_id;

    // Validate userId
    if (!candidateUserId || typeof candidateUserId !== "string" || !candidateUserId.trim()) {
      return res.status(400).json(view.apiError("userId is required"));
    }

    const trimmedCandidate = candidateUserId.trim();
    let userId = req.user?.id;

    if (!userId) {
      const user = await User.findById(trimmedCandidate);
      if (!user) {
        return res.status(404).json(view.apiError("User not found"));
      }
      userId = user.id;
    }

    // Validate fcmToken
    if (!fcmToken || typeof fcmToken !== "string" || !fcmToken.trim()) {
      return res.status(400).json(view.apiError("fcmToken is required"));
    }

    // Validate deviceType
    if (
      !deviceType ||
      typeof deviceType !== "string" ||
      !["android", "ios"].includes(deviceType.trim().toLowerCase())
    ) {
      return res.status(400).json(view.apiError("deviceType must be either 'android' or 'ios'"));
    }

    const trimmedToken = fcmToken.trim();
    const normalizedDeviceType = deviceType.trim().toLowerCase();
    const cleanDeviceId = typeof deviceId === "string" && deviceId.trim() ? deviceId.trim() : null;

    const tokenRecord = await FcmToken.upsert({
      userId,
      fcmToken: trimmedToken,
      deviceType: normalizedDeviceType,
      deviceId: cleanDeviceId,
    });

    if (!tokenRecord) {
      return res.status(500).json(view.apiError("Failed to register FCM token"));
    }

    return res.status(200).json(view.fcmTokenRegistered(tokenRecord));
  } catch (error) {
    if (error.code === "ECONNREFUSED") {
      console.error("Database connection refused.");
      return res.status(500).json(view.apiError("Database connection refused."));
    }
    console.error("FCM token registration failed:", error);
    return res.status(500).json(view.apiError("Internal server error"));
  }
}

module.exports = {
  registerFcmToken,
};
