'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const routeSource = fs.readFileSync(path.join(root, 'routes/consult-admin.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'routes/index.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'consult-admin-web/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'consult-admin-web/styles.css'), 'utf8');
const browserSource = fs.readFileSync(path.join(root, 'consult-admin-web/app.js'), 'utf8');
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));

test('consult workspace is an independent browser page rather than a mini-program page', () => {
  assert.doesNotMatch(appJson.pages.join('\n'), /consult-admin/);
  assert.match(appSource, /app\.get\(\['\/consult-admin', '\/api\/consult-admin'\]/);
  assert.match(appSource, /consult-admin-assets/);
  assert.match(appSource, /\/api\/consult-admin-assets/);
  assert.match(html, /href="\.\/consult-admin-assets\/styles\.css"/);
  assert.match(html, /src="\.\/consult-admin-assets\/app\.js"/);
  assert.match(html, /<table>/);
  assert.match(html, /id="mobileCards"/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.doesNotMatch(browserSource, /\bwx\./);
});

test('shared-link API protects consult data without requiring staff OpenID accounts', () => {
  assert.match(routeSource, /CONSULT_ADMIN_TOKEN/);
  assert.match(routeSource, /timingSafeEqual/);
  assert.match(routeSource, /authorization/);
  assert.doesNotMatch(routeSource, /jscode2session|CONSULT_ADMIN_OPENIDS/);
  assert.match(routeSource, /router\.get\('\/list'/);
  assert.match(routeSource, /router\.post\('\/:consultId\/process'/);
  assert.match(indexSource, /router\.use\('\/admin\/consults', consultAdminRouter\)/);
});

test('consult workspace supports search, status filters, remarks and processing', () => {
  for (const text of ['提交时间', '辅导类别', '具体诉求', '用户 OpenID', '状态', '客服备注', '标记为已处理']) {
    assert.ok(html.includes(text), `missing ${text}`);
  }
  assert.match(browserSource, /URLSearchParams/);
  assert.match(browserSource, /sessionStorage\.setItem\('consultAdminToken'/);
  assert.match(browserSource, /Authorization: `Bearer \$\{state\.token\}`/);
  assert.match(browserSource, /\/process`/);
});
