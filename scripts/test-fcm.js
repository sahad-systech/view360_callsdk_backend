require('dotenv').config();

const { initializeFirebase, admin } = require('../src/config/firebase');

async function testFCM() {
  try {
    const app = initializeFirebase();
    if (!app) {
      console.error('Firebase not initialized. Check your FIREBASE_SERVICE_ACCOUNT_PATH in .env');
      return;
    }

    // Pass token as command line argument or replace placeholder below:
    // e.g. node scripts/test-fcm.js <FCM_TOKEN>
    const fcmToken =
      process.argv[2] ||
      process.env.TEST_FCM_TOKEN ||
      'PASTE_PHONE_B_FCM_TOKEN';

    if (!fcmToken || fcmToken === 'PASTE_PHONE_B_FCM_TOKEN') {
      console.log('------------------------------------------------------------');
      console.log('Firebase Admin SDK is connected and working!');
      console.log('------------------------------------------------------------');
      console.log('To send a test push notification to Phone B:');
      console.log('  1. Obtain Phone B\'s FCM registration token from the client app.');
      console.log('  2. Run the command with the token:');
      console.log('     node scripts/test-fcm.js <PHONE_B_FCM_TOKEN>');
      console.log('------------------------------------------------------------');
      return;
    }

    console.log(`Sending test FCM message to token: ${fcmToken.substring(0, 20)}...`);

    const message = {
      token: fcmToken,
      data: {
        type: 'test',
        title: 'View360 Test',
        body: 'FCM is working successfully!',
        timestamp: new Date().toISOString(),
      },
      android: {
        priority: 'high',
      },
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'background',
        },
        payload: {
          aps: {
            'content-available': 1,
          },
        },
      },
    };

    const response = await admin.messaging().send(message);

    console.log('FCM message sent successfully!');
    console.log('Message ID:', response);
  } catch (error) {
    console.error('FCM test failed:');
    if (error.code) console.error('Error Code:', error.code);
    console.error('Error Message:', error.message);
  }
}

testFCM();
