import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    
    // Allow test mode with Bearer token
    if (!authHeader || !authHeader.startsWith('Bearer test-token-')) {
      return NextResponse.json({ error: 'Unauthorized - test token required' }, { status: 401 });
    }

    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const db = getAdminDb();
    const subscriptionRef = db.collection('subscriptions').where('userId', '==', userId);
    const snapshot = await subscriptionRef.get();

    if (snapshot.empty) {
      return NextResponse.json({ error: 'No subscription found for this user' }, { status: 404 });
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.update(doc.ref, {
        status: 'expired',
        expiredAt: new Date().toISOString(),
      });
    });

    await batch.commit();

    return NextResponse.json({
      success: true,
      message: 'Subscription expired for testing',
    });
  } catch (error) {
    console.error('Expire subscription error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to expire subscription' },
      { status: 500 }
    );
  }
}
