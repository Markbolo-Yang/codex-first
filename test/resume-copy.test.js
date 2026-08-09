'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const resumePageSource = fs.readFileSync(
  path.join(__dirname, '../pages/resume/resume.js'),
  'utf8'
);

const latestCopy = [
  '再等等，一些局部还在精心梳理中',
  '马上完成了，高P们正在做最后复盘',
  '啊哈～免费诊断次数用完啦',
  '本次诊断仅付0.01元',
  '正在整理订单，请稍候',
  '晕，专家被拉进一个突发会议。你稍后重试就行',
  '意外发生啦'
];

test('resume page keeps the latest user-facing copy', () => {
  for (const copy of latestCopy) {
    assert.match(resumePageSource, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('resume page source is not polluted by rendered markdown links', () => {
  assert.doesNotMatch(resumePageSource, /\[https:\/\//);
  assert.doesNotMatch(resumePageSource, /Comment view|Collapse file/);
});
