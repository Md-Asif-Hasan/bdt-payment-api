import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('x-bridge-key');
    
    // Verify bridge secret key
    if (!authHeader || authHeader !== process.env.BRIDGE_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { provider, amount, trxId, sender, rawMessage } = body;

    if (!provider || !amount || !trxId) {
      return NextResponse.json({ error: 'provider, amount, and trxId are required' }, { status: 400 });
    }

    const db = getAdminDb();
    
    // Find matching payment request
    const paymentRef = db.collection('payment_requests')
      .where('amount', '==', amount)
      .where('status', '==', 'awaiting_verification')
      .limit(1);
    
    const snapshot = await paymentRef.get();

    if (snapshot.empty) {
      return NextResponse.json({ error: 'No matching payment request found' }, { status: 404 });
    }

    const paymentDoc = snapshot.docs[0];
    const paymentData = paymentDoc.data();

    // Check if already processed
    if (paymentData.status === 'verified') {
      return NextResponse.json({ error: 'Payment already verified' }, { status: 409 });
    }

    // Update payment status
    await paymentDoc.ref.update({
      status: 'verified',
      verifiedAt: new Date().toISOString(),
      trxId,
      provider,
      sender,
      rawMessage,
    });

    // Create or update subscription
    const subscriptionRef = db.collection('subscriptions').doc(paymentData.userId);
    const subscriptionDoc = await subscriptionRef.get();

    const subscriptionData = {
      userId: paymentData.userId,
      plan: paymentData.plan,
      status: 'active',
      startDate: new Date().toISOString(),
      // Calculate end date based on plan
      endDate: calculateEndDate(paymentData.plan),
      amount: paymentData.amount,
      paymentRequestId: paymentDoc.id,
    };

    if (subscriptionDoc.exists) {
      await subscriptionRef.update(subscriptionData);
    } else {
      await subscriptionRef.set(subscriptionData);
    }

    return NextResponse.json({
      success: true,
      message: 'Payment verified and subscription activated',
      data: {
        requestId: paymentDoc.id,
        userId: paymentData.userId,
        plan: paymentData.plan,
      },
    });
  } catch (error) {
    console.error('Payment SMS error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process payment SMS' },
      { status: 500 }
    );
  }
}

function calculateEndDate(plan: string): string {
  const now = new Date();
  switch (plan) {
    case 'monthly':
      now.setMonth(now.getMonth() + 1);
      break;
    case 'quarterly':
      now.setMonth(now.getMonth() + 3);
      break;
    case 'yearly':
      now.setFullYear(now.getFullYear() + 1);
      break;
    case 'lifetime':
      now.setFullYear(now.getFullYear() + 100);
      break;
    default:
      now.setMonth(now.getMonth() + 1);
  }
  return now.toISOString();
}
