'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const {
  INTERNAL_TEST_PRICE_FEN,
  PUBLIC_PRICE_FEN,
  resolvePaymentPricing
} = require('../routes/payment-pricing');

function createDb(records) {
  const calls = [];
  return {
    calls,
    collection(name) {
      calls.push(['collection', name]);
      return {
        where(query) {
          calls.push(['where', query]);
          return {
            limit(value) {
              calls.push(['limit', value]);
              return {
                async get() {
                  return { data: records };
                }
              };
            }
          };
        }
      };
    }
  };
}

test('uses one fen for an active internal whitelist user', async () => {
  const db = createDb([{ openid: 'internal-user', active: true }]);
  const pricing = await resolvePaymentPricing(db, 'internal-user');

  assert.deepEqual(pricing, {
    totalFee: INTERNAL_TEST_PRICE_FEN,
    isInternalTest: true,
    pricingTier: 'internal_test'
  });
  assert.deepEqual(db.calls, [
    ['collection', 'internal_whitelist'],
    ['where', { openid: 'internal-user', active: true }],
    ['limit', 1]
  ]);
});

test('uses 499 fen when the user is not on the active whitelist', async () => {
  const pricing = await resolvePaymentPricing(createDb([]), 'public-user');

  assert.deepEqual(pricing, {
    totalFee: PUBLIC_PRICE_FEN,
    isInternalTest: false,
    pricingTier: 'public'
  });
});

test('does not hide whitelist database failures by granting a price', async () => {
  const db = {
    collection() {
      return {
        where() {
          return {
            limit() {
              return { get: async () => { throw new Error('database unavailable'); } };
            }
          };
        }
      };
    }
  };

  await assert.rejects(resolvePaymentPricing(db, 'any-user'), /database unavailable/);
});

test('the real WeChat order uses the resolved price for payment and persistence', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/index.js'), 'utf8');

  assert.match(source, /\['resume', 'interview'\]\.includes\(type\)/);
  assert.match(source, /resolvePaymentPricing\(db, openId\)/);
  assert.match(source, /amount: \{ total: pricing\.totalFee, currency: 'CNY' \}/);
  assert.match(source, /total_fee: pricing\.totalFee/);
  assert.match(source, /is_internal_test: pricing\.isInternalTest/);
});
