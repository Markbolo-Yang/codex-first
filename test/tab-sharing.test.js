'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pages = [
  ['resume', 'pages/resume/resume', '留畅拿offer｜大厂简历诊断'],
  ['interview', 'pages/interview/interview', '留畅拿offer｜大厂面试辅导'],
  ['mentor', 'pages/mentor/mentor', '留畅拿offer｜真人导师1V1助力']
];

for (const [name, pagePath, title] of pages) {
  test(`${name} tab supports chat and timeline sharing`, () => {
    const source = fs.readFileSync(path.join(__dirname, `../${pagePath}.js`), 'utf8');
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, `../${pagePath}.json`), 'utf8'));

    assert.equal(config.enableShareAppMessage, true);
    assert.equal(config.enableShareTimeline, true);
    assert.match(source, /menus: \['shareAppMessage', 'shareTimeline'\]/);
    assert.match(source, /onShareAppMessage\(\)/);
    assert.match(source, /onShareTimeline\(\)/);
    assert.ok(source.includes(`title: '${title}'`));
    assert.ok(source.includes(`path: '/${pagePath}'`));
  });
}
