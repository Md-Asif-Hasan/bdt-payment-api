import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { testStore } from '@/lib/test-store';

export const dynamic = 'force-dynamic';

// ─── helpers ─────────────────────────────────────────────────────────────────

function calculateEndDate(plan: string): string {
  const now = new Date();
  switch (plan) {
    case 'monthly':   now.setMonth(now.getMonth() + 1);        break;
    case 'quarterly': now.setMonth(now.getMonth() + 3);        break;
    case 'yearly':    now.setFullYear(now.getFullYear() + 1);  break;
    case 'lifetime':  now.setFullYear(now.getFullYear() + 100); break;
    default:          now.setMonth(now.getMonth() + 1);
  }
  return now.toISOString();
}

// ─── POST /api/payment-sms ────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const forceTest = url.searchParams.get('forceTest') === 'true';
    
    // 1. Auth check — bridge secret key (skip for test mode)
    const bridgeKey = request.headers.get('x-bridge-key');
    if (!forceTest && (!bridgeKey || bridgeKey !== process.env.BRIDGE_SECRET_KEY)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Parse body
    const body = await request.json();
    const { provider, amount, trxId, sender, rawMessage } = body;

    if (!provider || amount == null || !trxId) {
      return NextResponse.json(
        { error: 'provider, amount, and trxId are required' },
        { status: 400 },
      );
    }

    const numericAmount = Number(amount);

    // 3. ── TEST MODE ─────────────────────────────────────────────────────────
    //    Try test store first. If there is a matching awaiting_verification
    //    request we complete the test flow using Firestore test collections.
    console.log('[payment-sms] Attempting test verification with:', { trxId, amount: numericAmount, provider, sender });
    const testResult = await testStore.verifyBySms(trxId, numericAmount, provider, sender, rawMessage);
    console.log('[payment-sms] Test verification result:', testResult);
    if (testResult.ok) {
      return NextResponse.json({
        success: true,
        message: 'Payment verified and subscription activated (test mode)',
        data: {
          requestId: testResult.requestId,
          userId:    testResult.userId,
          plan:      testResult.plan,
          mode:      'test',
        },
      });
    }
    if (testResult.duplicate) {
      return NextResponse.json({ error: 'Payment already verified' }, { status: 409 });
    }
    
    // If not found in test store, fall back to production collection (for backward compatibility)
    if (testResult.error === 'No matching awaiting_verification request found for this amount and sender') {
      const db = getAdminDb();
      const snapshot = await db
        .collection('payment_requests')
        .where('amount', '==', numericAmount)
        .where('status', '==', 'awaiting_verification')
        .limit(10)
        .get();

      if (!snapshot.empty) {
        // Cross-check TrxID and sender number to find the exact match
        let paymentDoc = null;
        let paymentData = null;

        for (const doc of snapshot.docs) {
          const data = doc.data();
          const normalizePhone = (phone: string) => phone.replace(/[\s-]/g, '').replace(/^0/, '880').slice(-11);
          const normalizedSender = normalizePhone(sender || '');
          const normalizedStoredSender = normalizePhone(data.senderNumber || '');

          if (data.trxId === trxId && normalizedSender === normalizedStoredSender) {
            paymentDoc = doc;
            paymentData = data;
            break;
          }
        }

        if (paymentDoc && paymentData) {
          if (paymentData.status === 'verified') {
            return NextResponse.json({ error: 'Payment already verified' }, { status: 409 });
          }

          const verifiedAt = new Date().toISOString();
          const endDate = calculateEndDate(paymentData.plan);

          await paymentDoc.ref.update({
            status: 'verified',
            verifiedAt,
            trxId,
            provider,
            sender,
            rawMessage,
          });

          const subscriptionRef = db.collection('subscriptions').doc(paymentData.userId);
          const subscriptionSnap = await subscriptionRef.get();
          const subscriptionData = {
            userId: paymentData.userId,
            plan: paymentData.plan,
            status: 'active',
            startDate: verifiedAt,
            endDate,
            amount: paymentData.amount,
            paymentRequestId: paymentDoc.id,
          };
          if (subscriptionSnap.exists) {
            await subscriptionRef.update(subscriptionData);
          } else {
            await subscriptionRef.set(subscriptionData);
          }

          return NextResponse.json({
            success: true,
            message: 'Payment verified and subscription activated (production fallback)',
            data: {
              requestId: paymentDoc.id,
              userId: paymentData.userId,
              plan: paymentData.plan,
              endDate,
              mode: 'production_fallback',
            },
          });
        }
      }
    }

    // 4. ── PRODUCTION MODE ────────────────────────────────────────────────────
    const db = getAdminDb();

    // Find matching payment request by amount + awaiting_verification
    const snapshot = await db
      .collection('payment_requests')
      .where('amount', '==', numericAmount)
      .where('status', '==', 'awaiting_verification')
      .limit(10)
      .get();

    if (snapshot.empty) {
      return NextResponse.json(
        { error: 'No matching payment request found for this amount' },
        { status: 404 },
      );
    }

    // Cross-check TrxID and sender number to find the exact match
    let paymentDoc = null;
    let paymentData = null;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      // Normalize phone numbers (remove spaces, dashes, ensure 11 digits)
      const normalizePhone = (phone: string) => phone.replace(/[\s-]/g, '').replace(/^0/, '880').slice(-11);
      const normalizedSender = normalizePhone(sender || '');
      const normalizedStoredSender = normalizePhone(data.senderNumber || '');

      if (data.trxId === trxId && normalizedSender === normalizedStoredSender) {
        paymentDoc = doc;
        paymentData = data;
        break;
      }
    }

    if (!paymentDoc || !paymentData) {
      return NextResponse.json(
        { error: 'TrxID or sender number does not match any pending payment request' },
        { status: 400 },
      );
    }

    if (paymentData.status === 'verified') {
      return NextResponse.json({ error: 'Payment already verified' }, { status: 409 });
    }

    const verifiedAt = new Date().toISOString();
    const endDate    = calculateEndDate(paymentData.plan);

    // Mark payment request as verified
    await paymentDoc.ref.update({
      status:     'verified',
      verifiedAt,
      trxId,
      provider,
      sender,
      rawMessage,
    });

    // Upsert subscription record
    const subscriptionRef = db.collection('subscriptions').doc(paymentData.userId);
    const subscriptionSnap = await subscriptionRef.get();
    const subscriptionData = {
      userId:           paymentData.userId,
      plan:             paymentData.plan,
      status:           'active',
      startDate:        verifiedAt,
      endDate,
      amount:           paymentData.amount,
      paymentRequestId: paymentDoc.id,
    };
    if (subscriptionSnap.exists) {
      await subscriptionRef.update(subscriptionData);
    } else {
      await subscriptionRef.set(subscriptionData);
    }

    // ── Update user premium flag in the main users collection ──────────────
    // The main taka-jachai-modern app reads users/{uid}.premium and
    // users/{uid}.premiumUntil to gate premium features.
    try {
      const userRef = db.collection('users').doc(paymentData.userId);
      await userRef.set(
        {
          premium:      true,
          premiumUntil: endDate,
          premiumPlan:  paymentData.plan,
          updatedAt:    verifiedAt,
        },
        { merge: true }, // don't overwrite other user fields
      );
      console.log(`[payment-sms] Updated premium flag for user: ${paymentData.userId}`);
    } catch (userUpdateErr) {
      // Log but don't fail the request — payment is verified, flag update is best-effort
      console.error('[payment-sms] Failed to update user premium flag:', userUpdateErr);
    }

    return NextResponse.json({
      success: true,
      message: 'Payment verified and subscription activated',
      data: {
        requestId: paymentDoc.id,
        userId:    paymentData.userId,
        plan:      paymentData.plan,
        endDate,
      },
    });
  } catch (error) {
    console.error('[payment-sms] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process payment SMS' },
      { status: 500 },
    );
  }
}
