const FcmToken = require("../models/fcmToken");
const User = require("../models/user");
const view = require("../views/json");

async function registerUser(req, res) {
  try {
    const { id, name, email } = req.body || {};

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json(view.apiError("name is required"));
    }

    const trimmedName = name.trim();
    const cleanEmail = typeof email === "string" && email.trim() ? email.trim() : null;
    const cleanId = typeof id === "string" && id.trim() ? id.trim() : null;

    if (cleanEmail) {
      const existingUser = await User.findById(cleanEmail);
      if (existingUser) {
        return res.status(409).json(view.apiError("A user with this email already exists"));
      }
    }

    const newUser = await User.create({
      id: cleanId,
      name: trimmedName,
      email: cleanEmail,
    });

    return res.status(201).json(view.userCreated(newUser));
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json(view.apiError("User already exists"));
    }
    if (error.code === "ECONNREFUSED") {
      console.error("Database connection refused.");
      return res.status(500).json(view.apiError("Database connection refused."));
    }
    console.error("User registration failed:", error);
    return res.status(500).json(view.apiError("Internal server error"));
  }
}

async function getUser(req, res) {
  try {
    const { id } = req.params;
    if (!id || typeof id !== "string" || !id.trim()) {
      return res.status(400).json(view.apiError("User id is required"));
    }

    const user = await User.findById(id.trim());
    if (!user) {
      return res.status(404).json(view.apiError("User not found"));
    }

    return res.status(200).json(view.userDetails(user));
  } catch (error) {
    if (error.code === "ECONNREFUSED") {
      console.error("Database connection refused.");
      return res.status(500).json(view.apiError("Database connection refused."));
    }
    console.error("Get user failed:", error);
    return res.status(500).json(view.apiError("Internal server error"));
  }
}

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
  registerUser,
  getUser,
  registerFcmToken,
};
