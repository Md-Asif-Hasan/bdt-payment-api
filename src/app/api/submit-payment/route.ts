import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { testStore, isTestToken } from '@/lib/test-store';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const url = new URL(request.url);
    const forceTest = url.searchParams.get('forceTest') === 'true';
    
    const body = await request.json();
    const { requestId, trxId, senderNumber, amount } = body;

    if (!requestId || !trxId || !senderNumber) {
      return NextResponse.json({ error: 'requestId, trxId, and senderNumber are required' }, { status: 400 });
    }

    // ── TEST MODE ─────────────────────────────────────────────────────────────
    if (forceTest || isTestToken(authHeader)) {
      const result = await testStore.submitTrxId(requestId, trxId, senderNumber);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.error === 'Payment request not found' ? 404 : 400 });
      }
      return NextResponse.json({ success: true, message: 'TrxID submitted for verification' });
    }

    // ── PRODUCTION MODE ───────────────────────────────────────────────────────
    const db = getAdminDb();
    const paymentRef = db.collection('payment_requests').doc(requestId);
    const paymentDoc = await paymentRef.get();

    if (!paymentDoc.exists) {
      return NextResponse.json({ error: 'Payment request not found' }, { status: 404 });
    }

    const paymentData = paymentDoc.data();
    if (paymentData?.status !== 'pending') {
      return NextResponse.json({ error: 'Payment request is not in pending status' }, { status: 400 });
    }

    await paymentRef.update({
      status: 'awaiting_verification',
      trxId,
      senderNumber,
      amount: amount || paymentData.amount,
      submittedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, message: 'TrxID submitted for verification' });
  } catch (error) {
    console.error('Submit payment error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to submit TrxID' },
      { status: 500 }
    );
  }
}
