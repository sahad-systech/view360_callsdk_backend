const adminPackage = require("firebase-admin");
const { initializeApp, cert, getApps, getApp } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const fs = require("node:fs");
const path = require("node:path");

let firebaseApp = null;

function initFirebase() {
  if (firebaseApp) {
    return firebaseApp;
  }

  const existingApps = getApps();
  if (existingApps.length > 0) {
    firebaseApp = existingApps[0];
    return firebaseApp;
  }

  try {
    // 1. Direct JSON string via FIREBASE_SERVICE_ACCOUNT_KEY
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      const credentials =
        typeof process.env.FIREBASE_SERVICE_ACCOUNT_KEY === "string"
          ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
          : process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
      firebaseApp = initializeApp({ credential: cert(credentials) });
      return firebaseApp;
    }

    // 2. Service account file path via FIREBASE_SERVICE_ACCOUNT_PATH
    if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      const filePath = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, "utf8");
        const credentials = JSON.parse(fileContent);
        firebaseApp = initializeApp({ credential: cert(credentials) });
        return firebaseApp;
      } else {
        console.warn(`[Firebase] Service account file not found at ${filePath}`);
      }
    }

    // 3. Individual environment variables
    if (
      process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY
    ) {
      const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");
      firebaseApp = initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey,
        }),
      });
      return firebaseApp;
    }

    // 4. Application default credentials (GOOGLE_APPLICATION_CREDENTIALS)
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      firebaseApp = initializeApp();
      return firebaseApp;
    }

    console.warn("[Firebase] No Firebase credentials provided. Push notifications will be skipped.");
    return null;
  } catch (error) {
    console.error("[Firebase] Initialization error:", error.message);
    return null;
  }
}

function getMessagingService() {
  const app = initFirebase();
  if (!app) return null;
  return getMessaging(app);
}

function isInitialized() {
  return initFirebase() !== null;
}

function resetFirebase() {
  firebaseApp = null;
}

const admin = {
  ...adminPackage,
  app: (name) => {
    if (name) return getApp(name);
    if (firebaseApp) return firebaseApp;
    const apps = getApps();
    if (apps.length > 0) return apps[0];
    return getApp();
  },
  apps: getApps(),
  messaging: (app) => getMessaging(app || firebaseApp || getApp()),
};

module.exports = {
  admin,
  initFirebase,
  initializeFirebase: initFirebase,
  getMessagingService,
  isInitialized,
  resetFirebase,
};
