import { NextRequest, NextResponse } from 'next/server';
import admin from 'firebase-admin';
import { getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.BRIDGE_SECRET_KEY}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result: Record<string, any> = {
    env: {
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL ? '***SET***' : 'MISSING',
      privateKey:  process.env.FIREBASE_PRIVATE_KEY  ? `SET (${process.env.FIREBASE_PRIVATE_KEY.length} chars)` : 'MISSING',
    },
    apps: admin.apps.length,
  };

  // Test 1: can we get the db object?
  try {
    const db = getAdminDb();
    result.dbObject = 'OK';

    // Test 2: list collections (empty db is fine)
    try {
      const cols = await db.listCollections();
      result.listCollections = cols.map((c) => c.id);
    } catch (e: any) {
      result.listCollectionsError = { message: e.message, code: e.code, details: e.details };
    }

    // Test 3: write a test document
    try {
      const testRef = db.collection('_debug').doc('ping');
      await testRef.set({ ts: new Date().toISOString(), ok: true });
      result.writeTest = 'OK';
      await testRef.delete();
      result.deleteTest = 'OK';
    } catch (e: any) {
      result.writeError = { message: e.message, code: e.code, details: e.details };
    }
  } catch (e: any) {
    result.dbError = { message: e.message, code: e.code };
  }

  return NextResponse.json(result);
}
