const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");

const app = require("../src/app");
const User = require("../src/models/user");
const Call = require("../src/models/call");
const FcmToken = require("../src/models/fcmToken");
const firebaseConfig = require("../src/config/firebase");
const notificationService = require("../src/services/notificationService");
const userController = require("../src/controllers/userController");
const callController = require("../src/controllers/callController");

function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

function dispatchApp({ method, url, headers = {}, body = null }) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const req = new http.IncomingMessage(socket);
    req.method = method;
    req.url = url;

    const payload = body !== null ? JSON.stringify(body) : null;
    req.headers = {
      "content-type": "application/json",
      ...(payload !== null ? { "content-length": String(Buffer.byteLength(payload)) } : {}),
      ...headers,
    };

    const res = new http.ServerResponse(req);
    let rawBody = "";
    res.write = (chunk) => {
      if (chunk) rawBody += chunk;
      return true;
    };
    res.end = (chunk) => {
      if (chunk) rawBody += chunk;
      let parsed = null;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        parsed = rawBody;
      }
      resolve({ statusCode: res.statusCode, body: parsed });
    };

    process.nextTick(() => {
      if (payload !== null) {
        req.push(payload);
      }
      req.push(null);
    });

    app.handle(req, res);
  });
}

// -------------------------------------------------------------
// Register FCM Token API Tests (POST /api/users/fcm-token)
// -------------------------------------------------------------

test("Register FCM Token fails with 401 if unauthenticated", async () => {
  const req = { user: null, body: { fcmToken: "token-1", deviceType: "android" } };
  const res = createMockRes();

  await userController.registerFcmToken(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
});

test("Register FCM Token fails with 400 when fcmToken is missing or empty", async () => {
  for (const invalidToken of [undefined, null, "", "   "]) {
    const req = {
      user: { id: "user-1" },
      body: { fcmToken: invalidToken, deviceType: "android" },
    };
    const res = createMockRes();

    await userController.registerFcmToken(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "fcmToken is required");
  }
});

test("Register FCM Token fails with 400 when deviceType is invalid", async () => {
  for (const invalidDevice of [undefined, null, "", "windows", "web", 123]) {
    const req = {
      user: { id: "user-1" },
      body: { fcmToken: "valid-token", deviceType: invalidDevice },
    };
    const res = createMockRes();

    await userController.registerFcmToken(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "deviceType must be either 'android' or 'ios'");
  }
});

test("Register FCM Token ignores userId from request body and uses authenticated user", async (t) => {
  let upsertParams = null;
  t.mock.method(FcmToken, "upsert", async (params) => {
    upsertParams = params;
    return {
      id: "fcm-entry-uuid",
      userId: params.userId,
      fcmToken: params.fcmToken,
      deviceType: params.deviceType,
      deviceId: params.deviceId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  const req = {
    user: { id: "authenticated-user-id" },
    body: {
      userId: "spoofed-user-id", // MUST BE IGNORED
      fcmToken: "sample-fcm-token-123",
      deviceType: "android",
      deviceId: "pixel-7-device-id",
    },
  };
  const res = createMockRes();

  await userController.registerFcmToken(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.message, "FCM token registered successfully");
  assert.equal(upsertParams.userId, "authenticated-user-id");
  assert.equal(res.body.data.userId, "authenticated-user-id");
  assert.equal(res.body.data.fcmToken, "sample-fcm-token-123");
  assert.equal(res.body.data.deviceType, "android");
  assert.equal(res.body.data.deviceId, "pixel-7-device-id");
});

test("End-to-end Express route POST /api/users/fcm-token responds through app pipeline", async (t) => {
  const mockUser = { id: "e2e-user-fcm", name: "FCM Test User" };
  t.mock.method(User, "findById", async (id) => (id === "e2e-user-fcm" ? mockUser : null));

  t.mock.method(FcmToken, "upsert", async ({ userId, fcmToken, deviceType, deviceId }) => ({
    id: "fcm-record-1",
    userId,
    fcmToken,
    deviceType,
    deviceId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  const response = await dispatchApp({
    method: "POST",
    url: "/api/users/fcm-token",
    headers: { authorization: "Bearer e2e-user-fcm" },
    body: {
      fcmToken: "device-token-e2e",
      deviceType: "ios",
      deviceId: "iphone-15",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.userId, "e2e-user-fcm");
  assert.equal(response.body.data.fcmToken, "device-token-e2e");
  assert.equal(response.body.data.deviceType, "ios");
  assert.equal(response.body.data.deviceId, "iphone-15");
});

// -------------------------------------------------------------
// Remove FCM Token API Tests (DELETE /api/users/fcm-token)
// -------------------------------------------------------------

test("Remove FCM Token fails with 401 if unauthenticated", async () => {
  const req = { user: null, body: { fcmToken: "token-to-delete" } };
  const res = createMockRes();

  await userController.removeFcmToken(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
});

test("Remove FCM Token fails with 400 when fcmToken is missing or empty", async () => {
  for (const invalidToken of [undefined, null, "", "   "]) {
    const req = { user: { id: "user-1" }, body: { fcmToken: invalidToken } };
    const res = createMockRes();

    await userController.removeFcmToken(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "fcmToken is required");
  }
});

test("Remove FCM Token fails with 404 when token does not exist for authenticated user", async (t) => {
  t.mock.method(FcmToken, "deleteToken", async () => false);

  const req = { user: { id: "user-1" }, body: { fcmToken: "nonexistent-token" } };
  const res = createMockRes();

  await userController.removeFcmToken(req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "FCM token not found");
});

test("Remove FCM Token succeeds with 200 and deletes only authenticated user's token", async (t) => {
  let deleteParams = null;
  t.mock.method(FcmToken, "deleteToken", async (params) => {
    deleteParams = params;
    return true;
  });

  const req = { user: { id: "user-1" }, body: { fcmToken: "my-active-token" } };
  const res = createMockRes();

  await userController.removeFcmToken(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.message, "FCM token removed successfully");
  assert.deepEqual(deleteParams, { userId: "user-1", fcmToken: "my-active-token" });
});

test("End-to-end Express route DELETE /api/users/fcm-token responds through app pipeline", async (t) => {
  const mockUser = { id: "e2e-user-del", name: "Delete Token User" };
  t.mock.method(User, "findById", async (id) => (id === "e2e-user-del" ? mockUser : null));
  t.mock.method(FcmToken, "deleteToken", async () => true);

  const response = await dispatchApp({
    method: "DELETE",
    url: "/api/users/fcm-token",
    headers: { authorization: "Bearer e2e-user-del" },
    body: { fcmToken: "token-to-delete-e2e" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.message, "FCM token removed successfully");
});

// -------------------------------------------------------------
// Notification Service & FCM Multicast Tests
// -------------------------------------------------------------

test("NotificationService: gracefully handles receiver with 0 tokens without error", async (t) => {
  t.mock.method(FcmToken, "findByUserId", async () => []);

  const result = await notificationService.sendIncomingCallNotification("receiver-no-tokens", {
    callId: "call-1",
    callerId: "caller-1",
    roomName: "room-1",
  });

  assert.equal(result.success, true);
  assert.equal(result.sentCount, 0);
  assert.equal(result.message, "No registered devices for receiver");
});

test("NotificationService: sends multicast message with Android high priority and APNs background headers", async (t) => {
  const mockTokens = [
    { fcmToken: "device-token-android", deviceType: "android" },
    { fcmToken: "device-token-ios", deviceType: "ios" },
  ];
  t.mock.method(FcmToken, "findByUserId", async () => mockTokens);

  let sentPayload = null;
  t.mock.method(firebaseConfig, "getMessagingService", () => ({
    sendEachForMulticast: async (payload) => {
      sentPayload = payload;
      return {
        responses: [{ success: true }, { success: true }],
        successCount: 2,
        failureCount: 0,
      };
    },
  }));

  const callData = {
    callId: "call-uuid-123",
    callerId: "caller-uuid-456",
    callerName: "Alice Caller",
    receiverId: "receiver-uuid-789",
    roomName: "call-room-xyz",
    createdAt: "2026-11-23T12:00:00.000Z",
  };

  const result = await notificationService.sendIncomingCallNotification("receiver-uuid-789", callData);

  assert.equal(result.success, true);
  assert.equal(result.sentCount, 2);
  assert.equal(result.failureCount, 0);

  // Check multicast payload
  assert.deepEqual(sentPayload.tokens, ["device-token-android", "device-token-ios"]);
  assert.equal(sentPayload.android.priority, "high");
  assert.equal(sentPayload.apns.headers["apns-priority"], "10");
  assert.equal(sentPayload.apns.headers["apns-push-type"], "background");
  assert.equal(sentPayload.apns.payload.aps["content-available"], 1);

  // Verify all data values are strings
  for (const [key, value] of Object.entries(sentPayload.data)) {
    assert.equal(typeof value, "string", `Field ${key} must be a string`);
  }
  assert.equal(sentPayload.data.type, "incoming_call");
  assert.equal(sentPayload.data.callId, "call-uuid-123");
  assert.equal(sentPayload.data.callerId, "caller-uuid-456");
  assert.equal(sentPayload.data.roomName, "call-room-xyz");
  // Ensure no sensitive tokens or secrets are present
  assert.equal(sentPayload.data.livekitSecret, undefined);
  assert.equal(sentPayload.data.token, undefined);
});

test("NotificationService: detects invalid/expired tokens and deletes them from database", async (t) => {
  const mockTokens = [
    { fcmToken: "valid-token-1" },
    { fcmToken: "invalid-token-2" },
    { fcmToken: "expired-token-3" },
  ];
  t.mock.method(FcmToken, "findByUserId", async () => mockTokens);

  let deletedTokens = null;
  t.mock.method(FcmToken, "deleteMultipleTokens", async (tokens) => {
    deletedTokens = tokens;
    return tokens.length;
  });

  t.mock.method(firebaseConfig, "getMessagingService", () => ({
    sendEachForMulticast: async () => ({
      responses: [
        { success: true },
        { success: false, error: { code: "messaging/invalid-registration-token", message: "Invalid" } },
        { success: false, error: { code: "messaging/registration-token-not-registered", message: "Unregistered" } },
      ],
      successCount: 1,
      failureCount: 2,
    }),
  }));

  const result = await notificationService.sendIncomingCallNotification("receiver-with-bad-tokens", {
    callId: "call-clean",
    callerId: "caller-clean",
  });

  assert.equal(result.success, true);
  assert.equal(result.sentCount, 1);
  assert.equal(result.failureCount, 2);
  assert.deepEqual(deletedTokens, ["invalid-token-2", "expired-token-3"]);
});

// -------------------------------------------------------------
// Call Initiate + FCM Integration Resilience Tests
// -------------------------------------------------------------

test("Initiate Call succeeds even when FCM delivery fails completely", async (t) => {
  t.mock.method(User, "findById", async () => ({ id: "receiver-id", name: "Bob" }));

  let callCreated = false;
  t.mock.method(Call, "create", async (data) => {
    callCreated = true;
    return {
      callId: data.id,
      callerId: data.callerId,
      receiverId: data.receiverId,
      roomName: data.roomName,
      status: data.status,
    };
  });

  // Force notification service to throw an error
  t.mock.method(notificationService, "sendIncomingCallNotification", async () => {
    throw new Error("FCM network timeout or quota exceeded");
  });

  const req = {
    user: { id: "caller-id", name: "Alice" },
    body: { receiverId: "receiver-id" },
  };
  const res = createMockRes();

  await callController.initiate(req, res);

  // Call record must still be created, and API response must be 200 OK
  assert.equal(callCreated, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.message, "Call initiated successfully");
  assert.equal(res.body.data.status, "ringing");
});
