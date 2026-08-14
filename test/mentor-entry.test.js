'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const resumeJs = fs.readFileSync(path.join(root, 'pages/resume/resume.js'), 'utf8');
const resumeWxml = fs.readFileSync(path.join(root, 'pages/resume/resume.wxml'), 'utf8');
const mentorJs = fs.readFileSync(path.join(root, 'pages/mentor/mentor.js'), 'utf8');
const tabBarJs = fs.readFileSync(path.join(root, 'custom-tab-bar/index.js'), 'utf8');
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const tabBarWxml = fs.readFileSync(path.join(root, 'custom-tab-bar/index.wxml'), 'utf8');
const tabBarWxss = fs.readFileSync(path.join(root, 'custom-tab-bar/index.wxss'), 'utf8');

test('resume banner opens the mentor tab with career planning selected', () => {
  assert.match(resumeWxml, /class="banner"[^>]*bindtap="goToCareerPlanning"/);
  assert.match(resumeJs, /setStorageSync\('mentorDefaultType', 'careerPlanning'\)/);
  assert.match(resumeJs, /switchTab\(\{\s*url: '\/pages\/mentor\/mentor'/);
  assert.match(mentorJs, /careerPlanning: 0/);
  assert.match(mentorJs, /selectedCategory: this\.data\.categoryList\[index\]/);
  assert.match(mentorJs, /removeStorageSync\('mentorDefaultType'\)/);
});

test('the custom mentor tab displays a positioned HOT bubble', () => {
  assert.equal(appJson.tabBar.custom, true);
  assert.equal(appJson.tabBar.list[2].pagePath, 'pages/mentor/mentor');
  assert.match(tabBarWxml, /wx:if="\{\{item\.hot\}\}" class="tab-bar__hot">HOT/);
  assert.match(tabBarWxss, /\.tab-bar__hot\s*\{[^}]*position: absolute;/s);
  assert.match(tabBarWxss, /background: linear-gradient\([^;]*#f5222d/);
  assert.match(tabBarJs, /getCurrentPages\(\)/);
  assert.doesNotMatch(resumeJs, /setTabBarBadge/);
  assert.doesNotMatch(mentorJs, /setTabBarBadge/);
});
