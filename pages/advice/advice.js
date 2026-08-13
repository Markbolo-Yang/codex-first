'use strict';

const {
  emptyAdvice,
  normalizeAdvice,
  parseStreamingAdvice,
  hasAdviceContent
} = require('./advice-stream-parser');

const POLL_INTERVAL_MS = 1500;
const TYPE_INTERVAL_MS = 40;
const TYPE_STEP = 8;

function emptyReport() {
  return emptyAdvice();
}

function growText(current, target, budget) {
  if (current === target || budget <= 0) return [current, budget];
  if (!target.startsWith(current)) return [target, budget];
  const next = target.slice(0, Math.min(target.length, current.length + budget));
  return [next, budget - (next.length - current.length)];
}

function advanceReport(current, target, budget = TYPE_STEP) {
  const next = JSON.parse(JSON.stringify(current));
  [next.profileOverview, budget] = growText(next.profileOverview, target.profileOverview, budget);
  for (let i = 0; budget > 0 && i < target.keyExaminePoint.length; i += 1) {
    if (next.keyExaminePoint[i] === undefined) next.keyExaminePoint[i] = '';
    [next.keyExaminePoint[i], budget] = growText(next.keyExaminePoint[i], target.keyExaminePoint[i], budget);
  }
  [next.matchAdvice, budget] = growText(next.matchAdvice, target.matchAdvice, budget);
  for (const field of ['selfIntro', 'projectRule', 'interviewHabit']) {
    [next.interviewSkillGuide[field], budget] = growText(
      next.interviewSkillGuide[field],
      target.interviewSkillGuide[field],
      budget
    );
  }
  for (let i = 0; budget > 0 && i < target.questionList.length; i += 1) {
    if (!next.questionList[i]) next.questionList[i] = { title: '', thinking: '', sampleAnswer: '' };
    for (const field of ['title', 'thinking', 'sampleAnswer']) {
      [next.questionList[i][field], budget] = growText(
        next.questionList[i][field],
        target.questionList[i][field],
        budget
      );
    }
  }
  return next;
}

Page({
  data: {
    report: emptyReport(),
    generating: true,
    displayComplete: false,
    folds: {}
  },
  onLoad(options) {
    this.taskId = options.taskId;
    this.openid = options.openid;
    this.afterSeq = 0;
    this.generation = null;
    this.rawChunks = '';
    this.targetReport = emptyReport();
    this.backendSucceeded = false;
    this.poll();
  },
  onUnload() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    clearInterval(this.typeTimer);
  },
  poll() {
    if (this.stopped) return;
    wx.request({
      url: `${getApp().globalData.baseUrl}/api/interview/tasks/${encodeURIComponent(this.taskId)}`,
      method: 'GET',
      data: {
        openid: this.openid,
        after_seq: this.afterSeq,
        limit: 50
      },
      success: response => this.receiveTask(response.data?.data),
      fail: () => this.schedulePoll()
    });
  },
  receiveTask(task) {
    if (!task) return this.schedulePoll();
    if (this.generation !== null && this.generation !== task.generation) {
      this.afterSeq = 0;
      this.rawChunks = '';
      this.targetReport = emptyReport();
      this.backendSucceeded = false;
      this.setData({ report: emptyReport(), generating: true, displayComplete: false });
    }
    this.generation = task.generation;
    for (const chunk of task.chunks || []) {
      this.rawChunks += chunk.text || '';
    }
    this.afterSeq = task.latest_returned_seq;

    const preview = parseStreamingAdvice(this.rawChunks);
    if (preview && hasAdviceContent(preview)) {
      this.targetReport = preview;
      this.startTypewriter();
    }

    if (task.status === 'succeeded' && task.result) {
      this.backendSucceeded = true;
      this.targetReport = normalizeAdvice(task.result);
      this.startTypewriter();
      return;
    }
    if (task.status === 'failed' || task.status === 'cancelled') {
      return this.showFailure(task.error_message);
    }
    this.schedulePoll(task.has_more ? 0 : POLL_INTERVAL_MS);
  },
  schedulePoll(delay = POLL_INTERVAL_MS) {
    if (!this.stopped) {
      this.pollTimer = setTimeout(() => this.poll(), delay);
    }
  },
  startTypewriter() {
    if (this.typeTimer) return;
    this.typeTimer = setInterval(() => {
      const report = advanceReport(this.data.report, this.targetReport);
      const normalizedTarget = normalizeAdvice(this.targetReport);
      const complete = JSON.stringify(report) === JSON.stringify(normalizedTarget);
      const displayComplete = complete && this.backendSucceeded;
      this.setData({ report, generating: !displayComplete, displayComplete });
      if (complete) {
        clearInterval(this.typeTimer);
        this.typeTimer = null;
      }
    }, TYPE_INTERVAL_MS);
  },
  toggleFold(event) {
    const index = event.currentTarget.dataset.index;
    this.setData({ [`folds.${index}`]: !this.data.folds[index] });
  },
  showFailure(message) {
    wx.showModal({
      title: '意外发生啦',
      content: message || '面经的核心题库被卡住了，稍后重试即可',
      showCancel: false,
      confirmText: '我知道了',
      success: () => wx.navigateBack()
    });
  },

  goMentor() {
    wx.setStorageSync('mentorDefaultType', 'mockInterview');
    wx.switchTab({ url: '/pages/mentor/mentor' });
  }
});

module.exports = { emptyReport, advanceReport };
