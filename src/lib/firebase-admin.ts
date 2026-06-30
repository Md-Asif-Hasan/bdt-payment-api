import admin from 'firebase-admin';
import { getApps, getApp } from 'firebase-admin/app';

let _db: admin.firestore.Firestore | null = null;
let _auth: admin.auth.Auth | null = null;
let initError: Error | null = null;

function initializeApp() {
  if (getApps().length > 0) return getApp();

  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY;

  console.log('[Firebase] Checking env vars...');
  console.log(`  FIREBASE_PROJECT_ID:    ${projectId   ? 'SET' : 'MISSING'}`);
  console.log(`  FIREBASE_CLIENT_EMAIL:  ${clientEmail ? 'SET' : 'MISSING'}`);
  console.log(`  FIREBASE_PRIVATE_KEY:   ${privateKey  ? `SET (${privateKey.length} chars)` : 'MISSING'}`);

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      `Missing Firebase env vars — PROJECT_ID:${!!projectId} CLIENT_EMAIL:${!!clientEmail} PRIVATE_KEY:${!!privateKey}`,
    );
  }

  // Vercel stores \n as literal backslash-n — replace them
  const formattedKey = privateKey.replace(/\\n/g, '\n');

  const app = admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey: formattedKey }),
    // Explicitly point at the (default) Firestore database
    databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`,
  });

  console.log(`[Firebase] Initialized — project: ${projectId}`);
  return app;
}

export function getAdminDb(): admin.firestore.Firestore {
  if (_db) return _db;

  try {
    initializeApp();
    _db = admin.firestore();
    _db.settings({ ignoreUndefinedProperties: true });
    return _db;
  } catch (err) {
    initError = err instanceof Error ? err : new Error(String(err));
    console.error('[Firebase] getAdminDb error:', initError.message);
    throw initError;
  }
}

export function getAdminAuth(): admin.auth.Auth {
  if (_auth) return _auth;
  initializeApp();
  _auth = admin.auth();
  return _auth;
}

export function getFirebaseStatus() {
  return {
    initialized: getApps().length > 0,
    error: initError?.message ?? null,
    hasServiceAccount: !!(
      process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY
    ),
    projectId: process.env.FIREBASE_PROJECT_ID ?? null,
  };
}
