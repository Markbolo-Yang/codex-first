'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const backendSource = fs.readFileSync('routes/index.js', 'utf8');
const clientSource = fs.readFileSync('miniprogram/app.js', 'utf8');

test('mini-program creates users with consistent free and paid quotas', () => {
  const userCreates = [...clientSource.matchAll(/collection\('users'\)\.add\(\{([\s\S]*?)\n\s*\}\);/g)];
  assert.equal(userCreates.length, 2);
  for (const create of userCreates) {
    assert.match(create[1], /resumeFreeLeft: 2/);
    assert.match(create[1], /interviewFreeLeft: 2/);
    assert.match(create[1], /payResumeCount: 0/);
    assert.match(create[1], /payInterviewCount: 0/);
  }
  assert.doesNotMatch(clientSource, /resumeFreeLeft: 3|interviewFreeLeft: 3/);
  assert.equal((clientSource.match(/existingUser\.payResumeCount == null/g) || []).length, 2);
  assert.equal((clientSource.match(/existingUser\.payInterviewCount == null/g) || []).length, 2);
});

test('backend repairs missing paid quota fields for existing users', () => {
  assert.match(backendSource, /existingUser\.payResumeCount == null/);
  assert.match(backendSource, /userPatch\.payResumeCount = 0/);
  assert.match(backendSource, /existingUser\.payInterviewCount == null/);
  assert.match(backendSource, /userPatch\.payInterviewCount = 0/);
});
