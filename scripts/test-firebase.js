require('dotenv').config();

const { initializeFirebase, admin } = require('../src/config/firebase');

async function testFirebase() {
  try {
    const app = initializeFirebase();

    if (!app) {
      console.log('Firebase not configured. Please set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_KEY in .env.');
      return;
    }

    const projectId = admin.app().options.credential
      ? process.env.FIREBASE_PROJECT_ID || admin.app().options.projectId || 'Service account configured'
      : 'Not configured';

    console.log('Firebase connection successful');
    console.log('Project:', projectId);
  } catch (error) {
    console.error('Firebase connection failed:', error.message);
  }
}

testFirebase();
