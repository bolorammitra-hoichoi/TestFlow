// lib/firebase.js — single source of truth for credentials.
//
// ONE base64-encoded service-account JSON powers Firestore + Storage.
// Base64 has no newlines/quotes, so Vercel cannot mangle it. Generate the
// value once (PowerShell), using a service account from TestFlow's OWN
// Firebase project — do not reuse BridgeCx's project or key:
//
//   [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Content "service-account.json" -Raw)))
//
// and set it as the Vercel env var FIREBASE_SERVICE_ACCOUNT_B64.
// Also set FIREBASE_STORAGE_BUCKET (e.g. "testflow-xxxxx.appspot.com").

const admin = require('firebase-admin');

const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
if (!b64) throw new Error('FIREBASE_SERVICE_ACCOUNT_B64 env var is not set');

const serviceAccount = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
}

const db = admin.firestore();
const bucket = admin.storage().bucket();

module.exports = { admin, db, bucket, serviceAccount };
