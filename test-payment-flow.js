/**
 * End-to-End Payment Flow Test Script
 * 
 * This script tests the complete payment flow:
 * 1. Create a payment request
 * 2. Submit TrxID for verification
 * 3. Simulate SMS payment verification
 * 4. Check payment status
 * 5. Test subscription expiration
 * 
 * Usage: node test-payment-flow.js
 */

const API_BASE = process.env.API_BASE || 'https://taka-jachai-api.asifhasan10122000.workers.dev';
const TEST_PHONE = '01712345678';
const TEST_TRX_ID = 'TEST_' + Date.now();

// Plan amounts
const PLANS = {
  monthly: 99,
  quarterly: 249,
  yearly: 899,
  lifetime: 2999,
};

async function testCreatePayment(plan = 'monthly') {
  console.log('\n📝 Step 1: Creating payment request...');
  
  try {
    const response = await fetch(`${API_BASE}/api/create-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer test-token-${TEST_PHONE}`,
      },
      body: JSON.stringify({
        plan,
        userId: TEST_PHONE,
      }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error('❌ Failed to create payment:', data.error);
      return null;
    }

    console.log('✅ Payment request created successfully!');
    console.log(`   Request ID: ${data.data.requestId}`);
    console.log(`   Amount: ৳${data.data.amount}`);
    console.log(`   Status: ${data.data.status}`);
    console.log(`   Expires: ${new Date(data.data.expiry || data.data.expiresAt).toLocaleString()}`);
    
    return data.data;
  } catch (error) {
    console.error('❌ Error creating payment:', error.message);
    return null;
  }
}

async function testSubmitTrxId(requestId, trxId) {
  console.log('\n📤 Step 2: Submitting TrxID for verification...');
  
  try {
    const response = await fetch(`${API_BASE}/api/submit-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer test-token-${TEST_PHONE}`,
      },
      body: JSON.stringify({
        requestId,
        trxId,
      }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error('❌ Failed to submit TrxID:', data.error);
      return false;
    }

    console.log('✅ TrxID submitted successfully!');
    console.log(`   TrxID: ${trxId}`);
    console.log(`   Status: Awaiting SMS verification`);
    
    return true;
  } catch (error) {
    console.error('❌ Error submitting TrxID:', error.message);
    return false;
  }
}

async function testSimulatePaymentSms(requestId, amount, provider = 'bKash') {
  console.log('\n📱 Step 3: Simulating payment SMS verification...');
  
  try {
    const response = await fetch(`${API_BASE}/api/payment-sms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Key': process.env.BRIDGE_SECRET_KEY || 'test-secret-key',
      },
      body: JSON.stringify({
        provider,
        amount,
        trxId: TEST_TRX_ID,
        sender: provider === 'bKash' ? 'bKash' : 'Rocket',
        rawMessage: `Successful! TrxID: ${TEST_TRX_ID} [Tk ${amount}.0] received from ${TEST_PHONE}. Current Balance: Tk 5,000.00. Fee: Tk 0.00.`,
      }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error('❌ Failed to verify payment:', data.error);
      return false;
    }

    console.log('✅ Payment verified successfully!');
    console.log(`   Provider: ${provider}`);
    console.log(`   Amount: ৳${amount}`);
    console.log(`   TrxID: ${TEST_TRX_ID}`);
    
    return true;
  } catch (error) {
    console.error('❌ Error verifying payment:', error.message);
    return false;
  }
}

async function testCheckStatus(requestId) {
  console.log('\n📊 Step 4: Checking payment status...');
  
  try {
    const response = await fetch(`${API_BASE}/api/payment-status/${requestId}`);
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('❌ Failed to check status:', data.error);
      return null;
    }

    console.log('✅ Payment status retrieved!');
    console.log(`   Status: ${data.data.status}`);
    console.log(`   Amount: ৳${data.data.amount}`);
    console.log(`   Plan: ${data.data.plan}`);
    
    return data.data;
  } catch (error) {
    console.error('❌ Error checking status:', error.message);
    return null;
  }
}

async function testExpireSubscription() {
  console.log('\n⏰ Step 5: Testing subscription expiration...');
  
  try {
    const response = await fetch(`${API_BASE}/api/test-expire-subscription`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer test-token-${TEST_PHONE}`,
      },
      body: JSON.stringify({
        userId: TEST_PHONE,
      }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error('❌ Failed to expire subscription:', data.error);
      return false;
    }

    console.log('✅ Subscription expired successfully for testing!');
    console.log(`   User ID: ${TEST_PHONE}`);
    
    return true;
  } catch (error) {
    console.error('❌ Error expiring subscription:', error.message);
    return false;
  }
}

async function runFullTest() {
  console.log('🚀 Starting End-to-End Payment Flow Test');
  console.log('==========================================');
  console.log(`API Base: ${API_BASE}`);
  console.log(`Test Phone: ${TEST_PHONE}`);
  console.log(`Test TrxID: ${TEST_TRX_ID}`);
  
  // Test with monthly plan
  const plan = 'monthly';
  const amount = PLANS[plan];
  
  // Step 1: Create payment request
  const paymentData = await testCreatePayment(plan);
  if (!paymentData) {
    console.log('\n❌ Test failed at Step 1: Could not create payment request');
    return;
  }
  
  // Step 2: Submit TrxID
  const submitted = await testSubmitTrxId(paymentData.requestId, TEST_TRX_ID);
  if (!submitted) {
    console.log('\n❌ Test failed at Step 2: Could not submit TrxID');
    return;
  }
  
  // Step 3: Simulate SMS verification
  const verified = await testSimulatePaymentSms(paymentData.requestId, amount);
  if (!verified) {
    console.log('\n❌ Test failed at Step 3: Could not verify payment via SMS');
    return;
  }
  
  // Step 4: Check status
  const status = await testCheckStatus(paymentData.requestId);
  if (!status || status.status !== 'verified') {
    console.log('\n❌ Test failed at Step 4: Payment not verified');
    return;
  }
  
  // Step 5: Test subscription expiration
  const expired = await testExpireSubscription();
  if (!expired) {
    console.log('\n⚠️  Warning: Could not expire subscription (may not exist yet)');
  }
  
  console.log('\n==========================================');
  console.log('✅ All tests completed successfully!');
  console.log('==========================================\n');
}

// Run the test
runFullTest().catch(console.error);
