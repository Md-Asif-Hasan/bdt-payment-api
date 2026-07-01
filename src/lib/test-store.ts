/**
 * Test store for end-to-end testing.
 * Uses Firestore for persistence across Vercel serverless function restarts.
 * Used when Authorization header contains a "Bearer test-token-*" value.
 */

import { getAdminDb } from './firebase-admin';

export interface TestPaymentRequest {
  id: string;
  userId: string;
  plan: string;
  amount: number;
  status: 'pending' | 'awaiting_verification' | 'verified';
  createdAt: string;
  expiresAt: string;
  trxId?: string;
  senderNumber?: string;
  submittedAt?: string;
  verifiedAt?: string;
  provider?: string;
  sender?: string;
  rawMessage?: string;
}

export interface TestSubscription {
  userId: string;
  plan: string;
  status: 'active' | 'expired';
  startDate: string;
  endDate: string;
  amount: number;
  paymentRequestId: string;
  expiredAt?: string;
}

// Simple ID generator
function genId(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getPlanAmount(plan: string): number {
  const amounts: Record<string, number> = {
    monthly: 99,
    quarterly: 249,
    yearly: 899,
    lifetime: 2999,
  };
  return amounts[plan] ?? 99;
}

function calculateEndDate(plan: string): string {
  const now = new Date();
  switch (plan) {
    case 'monthly':   now.setMonth(now.getMonth() + 1); break;
    case 'quarterly': now.setMonth(now.getMonth() + 3); break;
    case 'yearly':    now.setFullYear(now.getFullYear() + 1); break;
    case 'lifetime':  now.setFullYear(now.getFullYear() + 100); break;
    default:          now.setMonth(now.getMonth() + 1);
  }
  return now.toISOString();
}

export const testStore = {
  // --- Payment Requests ---

  async createPayment(plan: string, userId: string): Promise<TestPaymentRequest> {
    const db = getAdminDb();
    const id = genId();
    const req: TestPaymentRequest = {
      id,
      userId,
      plan,
      amount: getPlanAmount(plan),
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
    await db.collection('test_payment_requests').doc(id).set(req);
    return req;
  },

  async getPayment(id: string): Promise<TestPaymentRequest | null> {
    const db = getAdminDb();
    const doc = await db.collection('test_payment_requests').doc(id).get();
    if (!doc.exists) return null;
    return doc.data() as TestPaymentRequest;
  },

  async submitTrxId(id: string, trxId: string, senderNumber?: string): Promise<{ ok: boolean; error?: string }> {
    const db = getAdminDb();
    const doc = await db.collection('test_payment_requests').doc(id).get();
    if (!doc.exists) return { ok: false, error: 'Payment request not found' };
    
    const req = doc.data() as TestPaymentRequest;
    if (req.status !== 'pending') return { ok: false, error: `Payment is already ${req.status}` };
    
    await db.collection('test_payment_requests').doc(id).update({
      status: 'awaiting_verification',
      trxId,
      senderNumber,
      submittedAt: new Date().toISOString(),
    });
    return { ok: true };
  },

  async verifyBySms(trxId: string, amount: number, provider: string, sender: string, rawMessage: string): Promise<{
    ok: boolean; error?: string; duplicate?: boolean; requestId?: string; userId?: string; plan?: string;
  }> {
    const db = getAdminDb();
    // Normalize phone numbers for comparison
    const normalizePhone = (phone: string) => phone.replace(/[\s-]/g, '').replace(/^0/, '880').slice(-11);

    // Find awaiting_verification request matching the amount
    const snapshot = await db.collection('test_payment_requests')
      .where('status', '==', 'awaiting_verification')
      .where('amount', '==', amount)
      .get();

    for (const doc of snapshot.docs) {
      const req = doc.data() as TestPaymentRequest;
      
      // If a trxId was submitted, verify it matches
      if (req.trxId && req.trxId !== trxId) continue;

      // Verify sender number matches if both are present
      if (req.senderNumber && sender) {
        const normalizedStoredSender = normalizePhone(req.senderNumber);
        const normalizedSmsSender = normalizePhone(sender);
        if (normalizedStoredSender !== normalizedSmsSender) continue;
      }

      await db.collection('test_payment_requests').doc(doc.id).update({
        status: 'verified',
        verifiedAt: new Date().toISOString(),
        provider,
        sender,
        rawMessage,
        trxId,
      });

      // Create/update subscription
      const sub: TestSubscription = {
        userId: req.userId,
        plan: req.plan,
        status: 'active',
        startDate: new Date().toISOString(),
        endDate: calculateEndDate(req.plan),
        amount: req.amount,
        paymentRequestId: doc.id,
      };
      await db.collection('test_subscriptions').doc(req.userId).set(sub);

      return { ok: true, requestId: doc.id, userId: req.userId, plan: req.plan };
    }

    // Check for duplicate
    const duplicateSnapshot = await db.collection('test_payment_requests')
      .where('status', '==', 'verified')
      .where('trxId', '==', trxId)
      .get();
    
    if (!duplicateSnapshot.empty) {
      return { ok: false, duplicate: true, error: 'Payment already verified' };
    }

    return { ok: false, error: 'No matching awaiting_verification request found for this amount and sender' };
  },

  async expireSubscription(userId: string): Promise<{ ok: boolean; error?: string; expiredAt?: string }> {
    const db = getAdminDb();
    const doc = await db.collection('test_subscriptions').doc(userId).get();
    if (!doc.exists) {
      // Also check by userId in collection
      const snapshot = await db.collection('test_subscriptions')
        .where('userId', '==', userId)
        .get();
      
      if (snapshot.empty) {
        return { ok: false, error: 'No subscription found for this user' };
      }
      
      const expiredAt = new Date().toISOString();
      await snapshot.docs[0].ref.update({
        status: 'expired',
        expiredAt,
      });
      return { ok: true, expiredAt };
    }
    
    const expiredAt = new Date().toISOString();
    await doc.ref.update({
      status: 'expired',
      expiredAt,
    });
    return { ok: true, expiredAt };
  },
};

/** Returns true if the Authorization header is a valid test token */
export function isTestToken(authHeader: string | null): boolean {
  return !!authHeader && authHeader.startsWith('Bearer test-token-');
}

/** Extracts the userId/phone from a test token header */
export function getTestUserId(authHeader: string | null): string {
  if (!authHeader) return 'test_user';
  const token = authHeader.replace('Bearer test-token-', '');
  return token || 'test_user';
}
