'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

let reportPage;
global.getApp = () => ({ globalData: {} });
global.Page = definition => { reportPage = definition; };
global.wx = {};
require('../pages/resume/report');
delete global.getApp;
delete global.Page;
delete global.wx;

function createPageContext() {
  return {
    ...reportPage,
    data: { ...reportPage.data },
    setData(update) {
      Object.assign(this.data, update);
    }
  };
}

test('leave reminder appears only on the first leave attempt', () => {
  const page = createPageContext();
  let leaveCount = 0;
  page.leaveForResume = () => { leaveCount += 1; };

  page.requestLeave();
  assert.equal(page.data.showLeaveReminder, true);
  assert.equal(leaveCount, 0);

  page.continueReading();
  assert.equal(page.data.showLeaveReminder, false);

  page.requestLeave();
  assert.equal(page.data.showLeaveReminder, false);
  assert.equal(leaveCount, 1);
});

test('confirming the first reminder leaves for the resume page', () => {
  const page = createPageContext();
  let leaveCount = 0;
  page.leaveForResume = () => { leaveCount += 1; };

  page.requestLeave();
  page.confirmLeave();

  assert.equal(page.data.showLeaveReminder, false);
  assert.equal(leaveCount, 1);
});

test('mentor action uses the same one-time reminder', () => {
  const page = createPageContext();
  page.data.isCompleted = true;

  page.goToMentorTab();

  assert.equal(page.data.showLeaveReminder, true);
});
