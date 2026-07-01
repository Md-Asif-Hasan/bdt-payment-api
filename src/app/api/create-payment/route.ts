import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { testStore, isTestToken, getTestUserId } from '@/lib/test-store';

export const dynamic = 'force-dynamic';

function getPlanAmount(plan: string): number {
  const amounts: Record<string, number> = {
    monthly: 99,
    quarterly: 249,
    yearly: 899,
    lifetime: 2999,
  };
  return amounts[plan] ?? 99;
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const url = new URL(request.url);
    const forceTest = url.searchParams.get('forceTest') === 'true';
    
    console.log('[create-payment] forceTest param:', forceTest);
    console.log('[create-payment] authHeader:', authHeader?.substring(0, 50) + '...');
    console.log('[create-payment] isTestToken:', isTestToken(authHeader));
    
    const body = await request.json();
    const { plan, userId: bodyUserId } = body;

    if (!plan) {
      return NextResponse.json({ error: 'plan is required' }, { status: 400 });
    }

    // ── TEST MODE (uses Firestore for persistence) ─────────────────────────────
    if (forceTest || isTestToken(authHeader)) {
      console.log('[create-payment] Using TEST MODE');
      const userId = getTestUserId(authHeader) || bodyUserId || 'test_user';
      const req = await testStore.createPayment(plan, userId);
      console.log('[create-payment] Created request:', req.id);
      return NextResponse.json({
        success: true,
        data: {
          requestId: req.id,
          ...req,
          expiry: req.expiresAt,
        },
      });
    }

    console.log('[create-payment] Using PRODUCTION MODE');
      });
    }

    // ── PRODUCTION MODE ───────────────────────────────────────────────────────
    const db = getAdminDb();
    const paymentRef = db.collection('payment_requests').doc();
    const requestId = paymentRef.id;

    const paymentData = {
      id: requestId,
      userId: bodyUserId || 'anonymous',
      plan,
      amount: getPlanAmount(plan),
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };

    await paymentRef.set(paymentData);

    return NextResponse.json({
      success: true,
      data: {
        requestId,
        ...paymentData,
        expiry: paymentData.expiresAt,
      },
    });
  } catch (error) {
    console.error('Create payment error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create payment request' },
      { status: 500 }
    );
  }
}
