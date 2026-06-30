import { NextResponse } from 'next/server';
import { getAdminDb, getFirebaseStatus } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

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

  let firebaseStatus = 'unknown';
  let firebaseLatency = 0;
  let firebaseError: string | null = null;

  try {
    const start = Date.now();
    const db = getAdminDb();
    await db.listCollections();
    firebaseLatency = Date.now() - start;
    firebaseStatus = 'healthy';
  } catch (error: any) {
    firebaseStatus = 'error';
    firebaseError = error.message || String(error.code) || 'Unknown error';
    console.error('[Firebase] Health check error:', firebaseError);
    metrics.errors++;
    metrics.lastErrorTime = now.toISOString();
  }

  const uptime = Math.floor((Date.now() - new Date(metrics.startTime).getTime()) / 1000);
  const fsInfo = getFirebaseStatus();

  return NextResponse.json({
    status: firebaseStatus === 'healthy' ? 'ok' : 'degraded',
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
      initialized: fsInfo.initialized,
      hasServiceAccount: fsInfo.hasServiceAccount,
      projectId: fsInfo.projectId,
    },
    environment: {
      projectId: process.env.FIREBASE_PROJECT_ID,
      nodeEnv: process.env.NODE_ENV,
      hasServiceAccount: !!(
        process.env.FIREBASE_PROJECT_ID &&
        process.env.FIREBASE_CLIENT_EMAIL &&
        process.env.FIREBASE_PRIVATE_KEY
      ),
      version: '1.3.0',
    },
  });
}
