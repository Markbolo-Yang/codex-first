'use strict';

const app = getApp();
const { FILE_REQUIREMENT_MESSAGE, validateSelectedFile, uploadResumeFile } = require('../resume/resume-file-parser');

const POLL_INTERVAL_MS = 1500;
const WAITING_COPY_20_MS = 20 * 1000;
const WAITING_COPY_50_MS = 50 * 1000;

Page({
  data: {
    inputContent: '',
    isPolling: false,
    articleList: [],
    showLoadingModal: false,
    loadingText: '正汲取多名大厂人的智慧'
  },

  onLoad() { this.getArticleList(); },

  onUnload() {
    this.clearOrderPolling();
    this.stopAdvicePolling();
    this.clearWaitingTimers();
    wx.hideLoading();
  },

  onInputChange(event) { this.setData({ inputContent: event.detail.value }); },

  request(path, data) {
    return new Promise(resolve => {
      wx.request({
        url: `${app.globalData.baseUrl}/api${path}`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data,
        success: response => resolve(response.data || {}),
        fail: () => resolve({})
      });
    });
  },

  async ensureOpenId() {
    let openid = app.globalData.openId || wx.getStorageSync('openid');
    if (!openid || openid === 'undefined') openid = (await app.getWxAuth())?.openid;
    return String(openid || '').trim();
  },

  clearOrderPolling() {
    if (this._orderPollTimer) clearInterval(this._orderPollTimer);
    this._orderPollTimer = null;
    this.setData({ isPolling: false });
  },

  async checkInterviewQuota() {
    const openId = await this.ensureOpenId();
    if (!openId) {
      wx.showToast({ title: '登录失败', icon: 'none' });
      return false;
    }
    const quota = await this.request('/getUserQuota', { openId });
    if (quota.code !== 0) {
      wx.showToast({ title: '获取次数失败', icon: 'none' });
      return false;
    }
    if (Number(quota.data?.interviewFreeLeft || 0) > 0 || Number(quota.data?.payInterviewCount || 0) > 0) return true;
    return this.startPay(openId);
  },

  startPay(openId) {
    return new Promise(resolve => {
      wx.showModal({
        title: '啊哈～免费面试建议次数用完啦',
        content: '本次建议生成仅0.01元',
        confirmText: '去支付',
        cancelText: '取消',
        success: result => result.confirm ? this.doPay(openId, resolve) : resolve(false)
      });
    });
  },

  async doPay(openId, resolve) {
    const order = await this.request('/createWxPayOrder', { openId, type: 'interview' });
    if (order.errcode !== 0 || !order.payParams) {
      wx.showToast({ title: '创建订单失败', icon: 'none' });
      resolve(false);
      return;
    }
    wx.requestPayment({
      ...order.payParams,
      success: () => this.startOrderPolling(order.out_trade_no, resolve),
      fail: () => {
        wx.showToast({ title: '支付已取消', icon: 'none' });
        resolve(false);
      }
    });
  },

  startOrderPolling(outTradeNo, resolve) {
    wx.showLoading({ title: '正在整理订单' });
    this.pollCount = 0;
    this.setData({ isPolling: true });
    this._orderPollTimer = setInterval(async () => {
      const order = await this.request('/queryPayOrder', { out_trade_no: outTradeNo });
      this.pollCount += 1;
      if (order.errcode === 0 && order.trade_state === 'SUCCESS') {
        this.clearOrderPolling();
        wx.hideLoading();
        wx.showToast({ title: '支付成功', icon: 'success' });
        resolve(true);
      } else if (this.pollCount >= 5) {
        this.clearOrderPolling();
        wx.hideLoading();
        wx.showToast({ title: '同步超时，请稍后查看', icon: 'none' });
        resolve(false);
      }
    }, 2500);
  },

  uploadResumeAndGetAdvice() {
    if (this.data.isPolling || this.data.showLoadingModal) return;
    const tip = wx.getStorageSync('interviewTip') || 0;
    if (tip < 2) {
      wx.setStorageSync('interviewTip', tip + 1);
      wx.showModal({ title: '上传提示', content: '请从聊天记录选择简历文件', showCancel: false, success: () => this.chooseFile() });
    } else this.chooseFile();
  },

  chooseFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: async result => {
        const file = result.tempFiles?.[0] || {};
        if (!validateSelectedFile(file)) {
          wx.showModal({ title: '文件格式不支持', content: FILE_REQUIREMENT_MESSAGE, showCancel: false, confirmText: '确定' });
          return;
        }
        const content = this.data.inputContent.trim();
        if (!content) {
          wx.showToast({ title: '请填写面试场景描述', icon: 'none' });
          return;
        }
        if (!await this.checkInterviewQuota()) return;
        this.beginAdvice({ hasResume: true, file, jobIntention: content });
      }
    });
  },

  async getAdviceWithoutResume() {
    const content = this.data.inputContent.trim();
    if (!content) {
      wx.showToast({ title: '请填写面试场景描述', icon: 'none' });
      return;
    }
    if (this.data.isPolling || this.data.showLoadingModal || !await this.checkInterviewQuota()) return;
    this.beginAdvice({ hasResume: false, jobIntention: content });
  },

  startWaitingTimers() {
    this.clearWaitingTimers();
    this._waiting20Timer = setTimeout(() => this.data.showLoadingModal && this.setData({ loadingText: '再等等，面试官们正在梳理重点' }), WAITING_COPY_20_MS);
    this._waiting50Timer = setTimeout(() => this.data.showLoadingModal && this.setData({ loadingText: '马上完成了，正在做最后复盘' }), WAITING_COPY_50_MS);
  },

  clearWaitingTimers() {
    if (this._waiting20Timer) clearTimeout(this._waiting20Timer);
    if (this._waiting50Timer) clearTimeout(this._waiting50Timer);
    this._waiting20Timer = null;
    this._waiting50Timer = null;
  },

  async beginAdvice({ hasResume, file, jobIntention }) {
    this.setData({ showLoadingModal: true, loadingText: '正汲取多名大厂人的智慧' });
    this.startWaitingTimers();
    try {
      const openid = await this.ensureOpenId();
      let parsed = { resumeInfo: '', resume_id: null };
      if (hasResume) parsed = await uploadResumeFile({ baseUrl: app.globalData.baseUrl, file });
      const response = await this.request('/interview/tasks', {
        openid,
        hasResume,
        resumeInfo: parsed.resumeInfo,
        resume_id: parsed.resume_id,
        jobIntention
      });
      if (response.code !== 0 || !response.data?.task_id) throw new Error(response.msg || '面试建议任务创建失败');
      this._adviceTaskId = response.data.task_id;
      this._adviceOpenId = openid;
      this.startAdvicePolling();
    } catch (error) {
      this.finishLoading();
      this.showFailure(error.message || '面试建议生成失败，请稍后重试');
    }
  },

  startAdvicePolling() {
    this.stopAdvicePolling();
    this._advicePolling = true;
    this.pollAdviceTask();
  },

  stopAdvicePolling() {
    this._advicePolling = false;
    if (this._advicePollTimer) clearTimeout(this._advicePollTimer);
    this._advicePollTimer = null;
  },

  async pollAdviceTask() {
    if (!this._advicePolling) return;
    try {
      const response = await new Promise((resolve, reject) => wx.request({
        url: `${app.globalData.baseUrl}/api/interview/tasks/${encodeURIComponent(this._adviceTaskId)}`,
        method: 'GET', data: { openid: this._adviceOpenId, after_seq: 0, limit: 1 }, success: resolve, fail: reject
      }));
      const task = response.data?.data;
      if (response.statusCode !== 200 || response.data?.code !== 0 || !task) throw new Error(response.data?.msg || '面试建议进度查询失败');
      if (task.status === 'succeeded' || task.chunks?.length > 0) {
        this.stopAdvicePolling();
        this.finishLoading();
        wx.navigateTo({ url: `/pages/advice/advice?taskId=${encodeURIComponent(this._adviceTaskId)}&openid=${encodeURIComponent(this._adviceOpenId)}` });
        return;
      }
      if (task.status === 'failed' || task.status === 'cancelled') {
        this.stopAdvicePolling();
        this.finishLoading();
        this.showFailure(task.error_message || '面试建议暂时没有完成，请稍后重试');
        return;
      }
    } catch (error) {
      console.error('面试建议轮询暂时失败', error);
    }
    if (this._advicePolling) this._advicePollTimer = setTimeout(() => this.pollAdviceTask(), POLL_INTERVAL_MS);
  },

  finishLoading() {
    this.stopAdvicePolling();
    this.clearWaitingTimers();
    this.setData({ showLoadingModal: false, loadingText: '正汲取多名大厂人的智慧' });
  },

  showFailure(message) {
    wx.showModal({ title: '意外发生啦', content: message, showCancel: false, confirmText: '我知道了' });
  },

  matchArticleIcon(title) {
    const rules = [
      { reg: /上岸|通过|拿下|offer|稳了|成功|逆袭|通关/, icon: '🎉' },
      { reg: /备考|备战|准备|倒计时|抓紧/, icon: '⏰' },
      { reg: /技巧|攻略|秘诀/, icon: '💡' },
      { reg: /经验|分享|干货/, icon: '📌' }
    ];
    const icons = rules.filter(rule => rule.reg.test(title)).map(rule => rule.icon);
    return Math.random() <= 1 / 3 ? (icons[0] || '🌟') + ' ' : '';
  },

  getArticleList() {
    wx.cloud.database().collection('articlePool').get().then(result => {
      const top = result.data.filter(item => item.isTop === true);
      const normal = result.data.filter(item => !item.isTop).sort(() => Math.random() - 0.5);
      this.setData({ articleList: [...top, ...normal.slice(0, 8 - top.length)].map(item => ({ ...item, icon: this.matchArticleIcon(item.title) })) });
    });
  },

  goToArticle(event) {
    const { url, type } = event.currentTarget.dataset;
    if (!url) return wx.showToast({ title: '链接为空', icon: 'none' });
    if (type === 'miniProgram') return wx.navigateToMiniProgram({ shortLink: url });
    if (wx.openOfficialAccountArticle) return wx.openOfficialAccountArticle({ url });
    wx.setClipboardData({ data: url });
  }
});
