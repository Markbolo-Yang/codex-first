'use strict';

const PUBLIC_PRICE_FEN = 499;
const INTERNAL_TEST_PRICE_FEN = 1;

async function resolvePaymentPricing(db, openid) {
  const whitelistResult = await db.collection('internal_whitelist')
    .where({ openid, active: true })
    .limit(1)
    .get();
  const isInternalTest = whitelistResult.data.length > 0;

  return {
    totalFee: isInternalTest ? INTERNAL_TEST_PRICE_FEN : PUBLIC_PRICE_FEN,
    isInternalTest,
    pricingTier: isInternalTest ? 'internal_test' : 'public'
  };
}

module.exports = {
  INTERNAL_TEST_PRICE_FEN,
  PUBLIC_PRICE_FEN,
  resolvePaymentPricing
};
