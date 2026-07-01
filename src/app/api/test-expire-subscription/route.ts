import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { testStore, isTestToken, getTestUserId } from '@/lib/test-store';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const url = new URL(request.url);
    const forceTest = url.searchParams.get('forceTest') === 'true';

    // Test-only endpoint — require test token or forceTest param
    if (!forceTest && !isTestToken(authHeader)) {
      return NextResponse.json(
        { error: 'Unauthorized — test token required' },
        { status: 401 },
      );
    }

    const body   = await request.json();
    const userId = body.userId || getTestUserId(authHeader);

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const expiredAt = new Date().toISOString();

    // ── Try test store first ────────────────────────────────────────
    const testResult = await testStore.expireSubscription(userId);

    // ── Also expire in Firestore (best-effort) ────────────────────────────────
    let firestoreExpired = false;
    try {
      const db       = getAdminDb();
      const snapshot = await db.collection('subscriptions').where('userId', '==', userId).get();

      if (!snapshot.empty) {
        const batch = db.batch();
        snapshot.docs.forEach((d) => {
          batch.update(d.ref, { status: 'expired', expiredAt });
        });
        await batch.commit();
        firestoreExpired = true;
      }

      // ── Clear user premium flag ────────────────────────────────────────────
      const userRef = db.collection('users').doc(userId);
      const userSnap = await userRef.get();
      if (userSnap.exists) {
        await userRef.update({
          premium:      false,
          premiumUntil: null,
          premiumPlan:  null,
          updatedAt:    expiredAt,
        });
        console.log(`[test-expire] Cleared premium flag for user: ${userId}`);
      }
    } catch (fsErr) {
      console.error('[test-expire] Firestore update failed (non-fatal):', fsErr);
    }

    if (!testResult.ok && !firestoreExpired) {
      return NextResponse.json(
        { error: 'No subscription found for this user' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      message:  'Subscription expired for testing',
      data:     { expiredAt, userId, firestoreExpired },
    });
  } catch (error) {
    console.error('[test-expire] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to expire subscription' },
      { status: 500 },
    );
  }
}
