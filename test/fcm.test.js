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

test("Register FCM Token fails with 400 if userId is missing from auth and body", async () => {
  const req = { user: null, body: { fcmToken: "token-1", deviceType: "android" } };
  const res = createMockRes();

  await userController.registerFcmToken(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "userId is required");
});

test("Register FCM Token fails with 404 when userId in body does not exist", async (t) => {
  t.mock.method(User, "findById", async () => null);

  const req = {
    user: null,
    body: { userId: "nonexistent-user", fcmToken: "token-1", deviceType: "android" },
  };
  const res = createMockRes();

  await userController.registerFcmToken(req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "User not found");
});

test("Register FCM Token succeeds with userId directly in body (no Authorization header)", async (t) => {
  const mockUser = { id: "body-user-uuid", name: "Body User" };
  t.mock.method(User, "findById", async (id) => (id === "body-user-uuid" ? mockUser : null));

  let upsertParams = null;
  t.mock.method(FcmToken, "upsert", async (params) => {
    upsertParams = params;
    return {
      id: "fcm-record-uuid",
      userId: params.userId,
      fcmToken: params.fcmToken,
      deviceType: params.deviceType,
      deviceId: params.deviceId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  const req = {
    user: null,
    body: {
      userId: "body-user-uuid",
      fcmToken: "token-from-body",
      deviceType: "android",
      deviceId: "pixel-phone",
    },
  };
  const res = createMockRes();

  await userController.registerFcmToken(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.message, "FCM token registered successfully");
  assert.equal(upsertParams.userId, "body-user-uuid");
  assert.equal(res.body.data.userId, "body-user-uuid");
  assert.equal(res.body.data.fcmToken, "token-from-body");
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

test("Register FCM Token prefers authenticated user over body userId when auth is present", async (t) => {
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
      userId: "spoofed-user-id",
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
});

test("End-to-end Express route POST /api/users/fcm-token works without Authorization header", async (t) => {
  const mockUser = { id: "no-auth-user", name: "No Auth User" };
  t.mock.method(User, "findById", async (id) => (id === "no-auth-user" ? mockUser : null));

  t.mock.method(FcmToken, "upsert", async ({ userId, fcmToken, deviceType, deviceId }) => ({
    id: "fcm-no-auth",
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
    body: {
      userId: "no-auth-user",
      fcmToken: "device-token-without-auth",
      deviceType: "android",
      deviceId: "samsung-galaxy",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.userId, "no-auth-user");
  assert.equal(response.body.data.fcmToken, "device-token-without-auth");
});

test("End-to-end Express route POST /api/users/fcm-token responds with Authorization header", async (t) => {
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
