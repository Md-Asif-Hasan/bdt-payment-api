import * as admin from 'firebase-admin';
import { getFirestore, Settings } from 'firebase-admin/firestore';

// ─── Singleton ────────────────────────────────────────────────────────────────
// Vercel serverless: each cold-start re-runs module code, so we guard
// with admin.apps (the global Firebase app registry).

let _db:    admin.firestore.Firestore | null = null;
let _auth:  admin.auth.Auth           | null = null;
let initError: Error                  | null = null;

function getOrInitApp(): admin.app.App {
  if (admin.apps.length > 0 && admin.apps[0]) return admin.apps[0];

  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY;

  console.log('[Firebase] Cold start — initialising...');
  console.log(`  PROJECT_ID:   ${projectId   ?? 'MISSING'}`);
  console.log(`  CLIENT_EMAIL: ${clientEmail ? '***SET***' : 'MISSING'}`);
  console.log(`  PRIVATE_KEY:  ${privateKey  ? `${privateKey.length} chars` : 'MISSING'}`);

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      `Missing Firebase env vars — PROJECT_ID:${!!projectId} CLIENT_EMAIL:${!!clientEmail} PRIVATE_KEY:${!!privateKey}`,
    );
  }

  // Vercel stores private key with literal \n — convert to actual newlines
  const formattedKey = privateKey.replace(/\\n/g, '\n');

  const app = admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey: formattedKey }),
    projectId: projectId,
  });

  console.log(`[Firebase] Initialised — project: ${projectId}`);
  return app;
}

export function getAdminDb(): admin.firestore.Firestore {
  if (_db) return _db;

  try {
    const app = getOrInitApp();

    // Try multiple approaches to connect to Firestore
    // First try without databaseId (let SDK auto-detect)
    try {
      _db = getFirestore(app);
      const settings: Settings = {
        ignoreUndefinedProperties: true,
        preferRest: true,
      };
      _db.settings(settings);
      console.log('[Firebase] Firestore initialized (auto-detect database)');
    } catch (autoErr: any) {
      console.warn('[Firebase] Auto-detect failed, trying explicit (default):', autoErr.message);
      console.warn('[Firebase] Auto-detect error code:', autoErr.code);
      // Fallback to explicit "(default)" databaseId
      try {
        _db = getFirestore(app, '(default)');
        const settings: Settings = {
          ignoreUndefinedProperties: true,
          preferRest: true,
        };
        _db.settings(settings);
        console.log('[Firebase] Firestore initialized with explicit databaseId: (default)');
      } catch (explicitErr: any) {
        console.error('[Firebase] Explicit (default) also failed:', explicitErr.message);
        console.error('[Firebase] Explicit error code:', explicitErr.code);
        console.error('[Firebase] Full error:', JSON.stringify(explicitErr, null, 2));
        throw explicitErr;
      }
    }

    return _db;
  } catch (err) {
    initError = err instanceof Error ? err : new Error(String(err));
    console.error('[Firebase] getAdminDb error:', initError.message);
    console.error('[Firebase] Error details:', JSON.stringify(err, null, 2));
    throw initError;
  }
}

export function getAdminAuth(): admin.auth.Auth {
  if (_auth) return _auth;
  const app = getOrInitApp();
  _auth = admin.auth(app);
  return _auth;
}

export function getFirebaseStatus() {
  return {
    initialized:       admin.apps.length > 0,
    error:             initError?.message ?? null,
    hasServiceAccount: !!(
      process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY
    ),
    projectId: process.env.FIREBASE_PROJECT_ID ?? null,
  };
}
