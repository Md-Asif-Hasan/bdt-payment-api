import { NextResponse } from 'next/server';
import { getAdminDb, getFirebaseStatus } from '@/lib/firebase-admin';

// Simple in-memory metrics (resets on deployment)
const metrics = {
  requestCount: 0,
  lastRequestTime: null as string | null,
  errors: 0,
  lastErrorTime: null as string | null,
  startTime: new Date().toISOString(),
};

export async function GET() {
  const now = new Date();
  metrics.requestCount++;
  metrics.lastRequestTime = now.toISOString();

  // Use the correct project ID (check both env var names for compatibility)
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  
  if (!projectId) {
    console.error('[Firebase] ERROR: No project ID found. Set FIREBASE_PROJECT_ID or NEXT_PUBLIC_FIREBASE_PROJECT_ID');
  }

  // Check Firebase connection
  let firebaseStatus = 'unknown';
  let firebaseLatency = 0;
  let firebaseError: string | null = null;
  
  try {
    const start = Date.now();
    // Try listing collections to verify connection
    const db = getAdminDb();
    await db.listCollections();
    firebaseLatency = Date.now() - start;
    firebaseStatus = 'healthy';
  } catch (error: any) {
    firebaseStatus = 'error';
    // Log the full error for debugging
    console.error('[Firebase] Full error details:', error);
    firebaseError = error.message || error.code || 'Unknown error';
    metrics.errors++;
    metrics.lastErrorTime = now.toISOString();
  }

  const uptime = Math.floor((Date.now() - new Date(metrics.startTime).getTime()) / 1000);
  const firebaseStatusInfo = getFirebaseStatus();

  // Add helpful context based on error type (after firebaseStatusInfo is defined)
  if (firebaseError && (firebaseError.includes('NOT_FOUND') || firebaseError.includes('404'))) {
    firebaseError += ` - Missing credentials. Project ID: ${projectId || firebaseStatusInfo.projectId}`;
  }
  if (firebaseError && (firebaseError.includes('PERMISSION_DENIED') || firebaseError.includes('403'))) {
    firebaseError += ' - Permission denied. Verify service account has Firestore permissions.';
  }

  return NextResponse.json({
    status: 'ok',
    timestamp: now.toISOString(),
    uptime: `${uptime}s`,
    metrics: {
      requestCount: metrics.requestCount,
      lastRequestTime: metrics.lastRequestTime,
      errors: metrics.errors,
      lastErrorTime: metrics.lastErrorTime,
    },
    firebase: {
      status: firebaseStatus,
      latency: `${firebaseLatency}ms`,
      error: firebaseError,
      initialized: firebaseStatusInfo.initialized,
      hasServiceAccount: firebaseStatusInfo.hasServiceAccount,
      projectId: firebaseStatusInfo.projectId,
    },
    environment: {
      projectId: process.env.FIREBASE_PROJECT_ID,
      nodeEnv: process.env.NODE_ENV,
      hasServiceAccount: !!(
        process.env.FIREBASE_PROJECT_ID &&
        process.env.FIREBASE_CLIENT_EMAIL &&
        process.env.FIREBASE_PRIVATE_KEY
      ),
      version: '1.2.0',
      url: process.env.NEXT_PUBLIC_API_URL || 'https://universal-bdt-payment-api.vercel.app',
    },
  });
}
