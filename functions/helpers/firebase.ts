
import admin from "firebase-admin";

const adminApp = admin.initializeApp({
  credential: admin.credential.cert(
    "./fika-4939a-firebase-adminsdk-ry3vy-1d9a1bf14e.json"
  ),
});

export const adminFirestore = adminApp.firestore();