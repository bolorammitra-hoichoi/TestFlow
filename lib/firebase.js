// lib/firebase.js — single source of truth for credentials.
//
// ONE base64-encoded service-account JSON powers Firestore. Base64 has no
// newlines/quotes, so Vercel cannot mangle it. Generate the value once
// (PowerShell — run it locally, never paste the output into chat), using a
// service account from TestFlow's OWN Firebase project — do not reuse
// BridgeCx's project or key, and do not reuse a production project's key
// either (see PROJECT.md — that's why Storage is skipped for v1):
//
//   [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Content "service-account.json" -Raw)))
//
// and set it as the Vercel env var FIREBASE_SERVICE_ACCOUNT_B64.
//
// No Firebase Storage in v1 — screenshots stay on the tester's local machine
// only, so this project never needed the Blaze billing plan. Revisit once
// Storage is worth the isolation cost (own bucket, own billing).

const admin = require('firebase-admin');

const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
if (!b64) throw new Error('FIREBASE_SERVICE_ACCOUNT_B64 env var is not set');

const serviceAccount = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();

module.exports = { admin, db, serviceAccount };
