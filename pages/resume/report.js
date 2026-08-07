'use strict';

const app = getApp();
const {
  emptyReport,
  normalizeReport,
  parseStreamingReport,
  hasReportContent
} = require('./diagnose-stream-parser');

const POLL_INTERVAL_MS = 1500;

Page({
  data: {
    report: emptyReport(),
    hasReportContent: false,
    isCompleted: false
  },

  onLoad(options) {
    this._taskId = options.taskId ? decodeURIComponent(options.taskId) : '';
    this._openid = options.openid
      ? decodeURIComponent(options.openid)
      : (app.globalData.openId || wx.getStorageSync('openid'));
    this._afterSeq = 0;
    this._generation = null;
    this._rawModelText = '';
    this._polling = true;
    if (!this._taskId || !this._openid) {
      this.stopPolling();
      this.showFatalError('诊断任务信息缺失，请返回后重试');
      return;
    }
    this.pollTask();
  },

  onUnload() {
    // 只停止页面轮询，不取消后端任务。
    this.stopPolling();
  },

  request(options) {
    return new Promise((resolve, reject) => {
      wx.request({
        ...options,
        success: response => resolve(response),
        fail: reject
      });
    });
  },

  stopPolling() {
    this._polling = false;
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this._pollTimer = null;
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
        data: {
          openid: this._openid,
          after_seq: this._afterSeq,
          limit: 50
        }
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
      // 网络抖动不等于诊断失败，后台任务继续执行。
      console.error('报告轮询暂时失败', error);
      this.scheduleNextPoll();
    }
  },

  consumeTask(task) {
    const generation = Number(task.generation || 0);
    if (this._generation !== null && generation !== this._generation) {
      this._rawModelText = '';
      this._afterSeq = 0;
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
    this.setData({ report, hasReportContent: true });
  },

  finishWithResult(result) {
    if (!result) {
      this.scheduleNextPoll(300);
      return;
    }
    this.stopPolling();
    const report = normalizeReport(result);
    this.setData({ report, hasReportContent: hasReportContent(report), isCompleted: true });
  },

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
    app.globalData.fromReportPage = true;
    wx.switchTab({ url: '/pages/mentor/mentor' });
  }
});
