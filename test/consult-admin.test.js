'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const routeSource = fs.readFileSync(path.join(root, 'routes/consult-admin.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'routes/index.js'), 'utf8');
const pageSource = fs.readFileSync(path.join(root, 'pages/mentor/consult-admin.js'), 'utf8');
const pageWxml = fs.readFileSync(path.join(root, 'pages/mentor/consult-admin.wxml'), 'utf8');
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));

test('consult admin endpoints require a fresh WeChat identity and an admin allowlist', () => {
  assert.match(routeSource, /CONSULT_ADMIN_OPENIDS/);
  assert.match(routeSource, /jscode2session/);
  assert.match(routeSource, /admins\.has\(data\.openid\)/);
  assert.match(routeSource, /router\.post\('\/list'/);
  assert.match(routeSource, /router\.post\('\/:consultId\/process'/);
  assert.match(indexSource, /router\.use\('\/admin\/consults', consultAdminRouter\)/);
});

test('consult admin page lists required fields and supports processing with remarks', () => {
  assert.ok(appJson.pages.includes('pages/mentor/consult-admin'));
  for (const binding of ['item.consultType', 'item.content', 'item.createTime', 'item._openid', 'item.status', 'item.remark']) {
    assert.ok(pageWxml.includes(binding), `missing ${binding}`);
  }
  assert.match(pageWxml, /bindtap="markProcessed"/);
  assert.match(pageSource, /\/api\/admin\/consults\/list/);
  assert.match(pageSource, /\/process`/);
  assert.match(pageSource, /wx\.login/);
});
