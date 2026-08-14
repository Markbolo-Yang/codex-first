'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const resumeJs = fs.readFileSync(path.join(root, 'pages/resume/resume.js'), 'utf8');
const resumeWxml = fs.readFileSync(path.join(root, 'pages/resume/resume.wxml'), 'utf8');
const mentorJs = fs.readFileSync(path.join(root, 'pages/mentor/mentor.js'), 'utf8');

test('resume banner opens the mentor tab with career planning selected', () => {
  assert.match(resumeWxml, /class="banner"[^>]*bindtap="goToCareerPlanning"/);
  assert.match(resumeJs, /setStorageSync\('mentorDefaultType', 'careerPlanning'\)/);
  assert.match(resumeJs, /switchTab\(\{\s*url: '\/pages\/mentor\/mentor'/);
  assert.match(mentorJs, /careerPlanning: 0/);
  assert.match(mentorJs, /selectedCategory: this\.data\.categoryList\[index\]/);
  assert.match(mentorJs, /removeStorageSync\('mentorDefaultType'\)/);
});

test('the native mentor tab badge displays HOT', () => {
  for (const source of [resumeJs, mentorJs]) {
    assert.match(source, /setTabBarBadge\(\{\s*index: 2,\s*text: 'HOT'/);
  }
});
