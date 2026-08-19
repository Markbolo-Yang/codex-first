'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const routeSource = fs.readFileSync(path.join(__dirname, '../routes/index.js'), 'utf8');
const pageSource = fs.readFileSync(path.join(__dirname, '../pages/mine/orderlist/orderlist.js'), 'utf8');
const templateSource = fs.readFileSync(path.join(__dirname, '../pages/mine/orderlist/orderlist.wxml'), 'utf8');
const styleSource = fs.readFileSync(path.join(__dirname, '../pages/mine/orderlist/orderlist.wxss'), 'utf8');

test('order list API filters by user and paginates newest orders', () => {
  const handler = routeSource.slice(
    routeSource.indexOf("router.post('/getUserOrderList'"),
    routeSource.indexOf('// ========== 微信 V3 下单 ==========')
  );

  assert.match(handler, /\{ 'data\.openid': normalizedOpenId \}/);
  assert.match(handler, /orderBy\('data\.out_trade_no', 'desc'\)/);
  assert.match(handler, /skip\(\(page - 1\) \* pageSize\)/);
  assert.match(handler, /pageSize = Math\.min\(100/);
  assert.match(handler, /hasMore: page \* pageSize < countRes\.total/);
  assert.doesNotMatch(handler, /拉取全部订单/);
});

test('mini-program order list refreshes and loads subsequent pages', () => {
  assert.match(pageSource, /getOrderData\(true\)/);
  assert.match(pageSource, /this\.data\.page \+ 1/);
  assert.match(pageSource, /data: \{ openId, page, pageSize: this\.data\.pageSize \}/);
  assert.match(pageSource, /Boolean\(result\.data\.hasMore\)/);
  assert.match(templateSource, /bindscrolltolower="onOrderListLower"/);
  assert.match(templateSource, /\{\{item\.statusText\}\}/);
  assert.match(styleSource, /\.list-tip\s*\{[\s\S]*text-align: center;/);
  assert.match(styleSource, /font-size: 22rpx;/);
  assert.match(styleSource, /color: #c6c9cf;/);
});
