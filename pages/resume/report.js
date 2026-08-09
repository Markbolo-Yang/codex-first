'use strict';

const app = getApp();
const {
  emptyReport,
  normalizeReport,
  parseStreamingReport,
  hasReportContent,
  advanceReportDisplay
} = require('./diagnose-stream-parser');

const POLL_INTERVAL_MS = 1500;
const TYPEWRITER_INTERVAL_MS = 40;
const TYPEWRITER_CHAR_BUDGET = 8;

Page({
  data: {
    report: emptyReport(),
    hasReportContent: false,
    isCompleted: false,
    showLeaveReminder: false,
    navigationBarHeight: 88,
    navigationContentHeight: 44
  },

  onLoad(options) {
    this._taskId = options.taskId ? decodeURIComponent(options.taskId) : '';
    this._openid = options.openid
      ? decodeURIComponent(options.openid)
      : (app.globalData.openId || wx.getStorageSync('openid'));
    this._afterSeq = 0;
    this._generation = null;
    this._rawModelText = '';
    this._targetReport = emptyReport();
    this._finalTargetReceived = false;
    this._polling = true;
    this._leaveReminderShown = false;
    this.setupNavigationBar();
    if (!this._taskId || !this._openid) {
      this.stopPolling();
      this.showFatalError('诊断任务信息缺失，请返回后重试');
      return;
    }
    this.pollTask();
  },

  onUnload() {
    this.stopPolling();
    this.stopTypewriter();
  },

  setupNavigationBar() {
    try {
      const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menuButton = wx.getMenuButtonBoundingClientRect();
      const statusBarHeight = Number(windowInfo.statusBarHeight || 0);
      const navigationContentHeight = (menuButton.top - statusBarHeight) * 2 + menuButton.height;
      this.setData({
        navigationBarHeight: statusBarHeight + navigationContentHeight,
        navigationContentHeight
      });
    } catch (error) {
      console.warn('读取导航栏尺寸失败，使用默认尺寸', error);
    }
  },

  request(options) {
    return new Promise((resolve, reject) => {
      wx.request({ ...options, success: resolve, fail: reject });
    });
  },

  stopPolling() {
    this._polling = false;
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this._pollTimer = null;
  },

  stopTypewriter() {
    if (this._typewriterTimer) clearTimeout(this._typewriterTimer);
    this._typewriterTimer = null;
  },

  scheduleNextPoll(delay = POLL_INTERVAL_MS) {
    if (!this._polling) return;
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this._pollTimer = setTimeout(() => this.pollTask(), delay);
  },

  async pollTask() {
    if (!this._polling) return;
    try {
      const response = await this.request({
        url: `${app.globalData.baseUrl}/api/diagnose/tasks/${encodeURIComponent(this._taskId)}`,
        method: 'GET',
        data: { openid: this._openid, after_seq: this._afterSeq, limit: 50 }
      });
      const task = response.data?.data;
      if (response.statusCode !== 200 || response.data?.code !== 0 || !task) {
        throw new Error(response.data?.msg || '诊断进度查询失败');
      }
      this.consumeTask(task);
      if (task.status === 'succeeded') {
        this.finishWithResult(task.result);
        return;
      }
      if (task.status === 'failed' || task.status === 'cancelled') {
        this.stopPolling();
        this.showFatalError(this.errorMessage(task));
        return;
      }
      this.scheduleNextPoll(task.has_more ? 100 : POLL_INTERVAL_MS);
    } catch (error) {
      console.error('报告轮询暂时失败', error);
      this.scheduleNextPoll();
    }
  },

  consumeTask(task) {
    const generation = Number(task.generation || 0);
    if (this._generation !== null && generation !== this._generation) {
      this._rawModelText = '';
      this._afterSeq = 0;
      this._targetReport = emptyReport();
      this._finalTargetReceived = false;
      this.stopTypewriter();
      this.setData({ report: emptyReport(), hasReportContent: false, isCompleted: false });
    }
    this._generation = generation;
    const chunks = Array.isArray(task.chunks)
      ? task.chunks.slice().sort((left, right) => Number(left.seq) - Number(right.seq))
      : [];
    chunks.forEach(chunk => {
      if (Number(chunk.seq) <= this._afterSeq) return;
      this._rawModelText += typeof chunk.text === 'string' ? chunk.text : '';
      this._afterSeq = Number(chunk.seq);
    });
    if (Number(task.latest_returned_seq) > this._afterSeq) {
      this._afterSeq = Number(task.latest_returned_seq);
    }
    if (chunks.length > 0) this.renderStreamingSnapshot();
  },

  renderStreamingSnapshot() {
    const report = parseStreamingReport(this._rawModelText);
    if (!report || !hasReportContent(report)) return;
    this.setTypewriterTarget(report, false);
  },

  finishWithResult(result) {
    if (!result) {
      this.scheduleNextPoll(300);
      return;
    }
    this.stopPolling();
    this.setTypewriterTarget(normalizeReport(result), true);
  },

  setTypewriterTarget(report, isFinal) {
    this._targetReport = normalizeReport(report);
    if (isFinal) this._finalTargetReceived = true;
    if (!this._typewriterTimer) this.runTypewriterTick();
  },

  runTypewriterTick() {
    this.stopTypewriter();
    const step = advanceReportDisplay(
      this.data.report,
      this._targetReport || emptyReport(),
      TYPEWRITER_CHAR_BUDGET
    );
    const completed = Boolean(this._finalTargetReceived && step.done);
    this.setData({
      report: step.report,
      hasReportContent: hasReportContent(step.report),
      isCompleted: completed
    });
    if (!step.done) {
      this._typewriterTimer = setTimeout(() => this.runTypewriterTick(), TYPEWRITER_INTERVAL_MS);
    }
  },

  requestLeave() {
    if (this._leaveReminderShown) {
      this.leaveForResume();
      return;
    }
    this._leaveReminderShown = true;
    this.setData({ showLeaveReminder: true });
  },

  continueReading() {
    this.setData({ showLeaveReminder: false });
  },

  confirmLeave() {
    this.setData({ showLeaveReminder: false });
    this.leaveForResume();
  },

  leaveForResume() {
    wx.navigateBack({
      delta: 1,
      fail: error => {
        console.error('返回简历页失败', error);
        wx.showToast({ title: '返回失败，请再试一次', icon: 'none' });
      }
    });
  },

  preventModalClose() {},

  errorMessage(task) {
    if (task.error_code === 'FIRST_TOKEN_TIMEOUT') {
      return '晕，专家突然被拉进一个临时会议。你稍后重试就行';
    }
    if (task.error_code === 'STREAM_STUCK') {
      return '晕，结论还没写完就被一个会议打断了。你稍后重试就行。';
    }
    return task.error_message || '诊断暂时没有完成，请稍后重试';
  },

  showFatalError(message) {
    this.stopTypewriter();
    wx.showModal({
      title: '诊断中断',
      content: message,
      showCancel: false,
      confirmText: '我知道了',
      success: () => wx.navigateBack()
    });
  },

  copyText(event) {
    const text = event.currentTarget.dataset.text || '';
    if (!text || !this.data.isCompleted) return;
    wx.setClipboardData({
      data: text,
      success() {
        wx.showToast({ title: '复制成功，记得调整细节', icon: 'success', duration: 1800 });
      }
    });
  },

  goToMentorTab() {
    if (!this.data.isCompleted) return;
    this.requestLeave();
  }
});
