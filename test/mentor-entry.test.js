'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const resumeJs = fs.readFileSync(path.join(root, 'pages/resume/resume.js'), 'utf8');
const resumeWxml = fs.readFileSync(path.join(root, 'pages/resume/resume.wxml'), 'utf8');
const mentorJs = fs.readFileSync(path.join(root, 'pages/mentor/mentor.js'), 'utf8');
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));

test('resume banner opens the mentor tab with career planning selected', () => {
  assert.match(resumeWxml, /class="banner"[^>]*bindtap="goToCareerPlanning"/);
  assert.match(resumeJs, /setStorageSync\('mentorDefaultType', 'careerPlanning'\)/);
  assert.match(resumeJs, /switchTab\(\{\s*url: '\/pages\/mentor\/mentor'/);
  assert.match(mentorJs, /careerPlanning: 0/);
  assert.match(mentorJs, /selectedCategory: this\.data\.categoryList\[index\]/);
  assert.match(mentorJs, /removeStorageSync\('mentorDefaultType'\)/);
});

test('the native mentor tab displays HOT without changing the tab bar appearance', () => {
  assert.equal(appJson.tabBar.custom, undefined);
  assert.deepEqual(appJson.tabBar, {
    color: '#666',
    selectedColor: '#1677ff',
    backgroundColor: '#ffffff',
    list: [
      { pagePath: 'pages/resume/resume', text: '简历诊断', iconPath: 'images/tab/resume.png', selectedIconPath: 'images/tab/resume_active.png' },
      { pagePath: 'pages/interview/interview', text: '面试辅导', iconPath: 'images/tab/interview.png', selectedIconPath: 'images/tab/interview_active.png' },
      { pagePath: 'pages/mentor/mentor', text: '真人导师', iconPath: 'images/tab/mentor.png', selectedIconPath: 'images/tab/mentor_active.png' },
      { pagePath: 'pages/mine/mine', text: '我的', iconPath: 'images/tab/mine.png', selectedIconPath: 'images/tab/mine_active.png' }
    ]
  });
  for (const source of [resumeJs, mentorJs]) {
    assert.match(source, /setTabBarBadge\(\{\s*index: 2,\s*text: 'HOT'/);
    assert.doesNotMatch(source, /getTabBar/);
  }
});
