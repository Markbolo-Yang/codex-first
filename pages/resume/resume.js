'use strict';

const app = getApp();
const { buildMockResume } = require('./diagnose-mock');

const POLL_INTERVAL_MS = 1500;
const WAITING_COPY_20_MS = 20 * 1000;
const WAITING_COPY_50_MS = 50 * 1000;

Page({
  data: {
    userDesc: '',
    isAnalyzing: false,
    analyzingText: '大厂专家的分身正在赶来的路上',
    resumeList: [],
    isLoading: false,
    isPolling: false,
    isSubmitting: false
  },

  onLoad() {
    this.setData({ resumeList: [] });
    wx.nextTick(() => this.getRandomResumeData());
  },

  onUnload() {
    this.clearOrderPolling();
    this.stopDiagnosisPolling();
    this.clearWaitingCopyTimers();
    wx.hideLoading();
  },

  clearOrderPolling() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = null;
    this.setData({ isPolling: false });
  },

  clearWaitingCopyTimers() {
    if (this._waiting20Timer) clearTimeout(this._waiting20Timer);
    if (this._waiting50Timer) clearTimeout(this._waiting50Timer);
    this._waiting20Timer = null;
    this._waiting50Timer = null;
  },

  startWaitingCopyTimers() {
    this.clearWaitingCopyTimers();
    this._waiting20Timer = setTimeout(() => {
      if (this.data.isAnalyzing) {
        this.setData({ analyzingText: '再等等，一些局部思路还在精心梳理中' });
      }
    }, WAITING_COPY_20_MS);
    this._waiting50Timer = setTimeout(() => {
      if (this.data.isAnalyzing) {
        this.setData({ analyzingText: '马上完成了，高P们正在最后的复盘' });
      }
    }, WAITING_COPY_50_MS);
  },

  async getRandomResumeData() {
    if (this.data.isLoading) return;
    this.setData({ isLoading: true });
    const db = wx.cloud.database();
    const batchSize = 20;
    let allData = [];
    let skip = 0;
    try {
      while (true) {
        const result = await db.collection('resumePool')
          .where({ _id: db.command.exists(true) })
          .orderBy('_id', 'asc')
          .skip(skip)
          .limit(batchSize)
          .get();
        if (result.data.length === 0) break;
        allData = allData.concat(result.data);
        skip += batchSize;
      }
      for (let index = allData.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        [allData[index], allData[randomIndex]] = [allData[randomIndex], allData[index]];
      }
      this.setData({
        resumeList: allData.slice(0, 4).map(item => ({
          ...item,
          fileType: Math.random() > 0.5 ? 'pdf' : 'word'
        })),
        isLoading: false
      });
    } catch (error) {
      console.error('读取失败', error);
      this.setData({ isLoading: false });
    }
  },

  onRefreshSample() {
    if (this.data.isLoading) return;
    wx.showToast({ title: '刷新中', icon: 'loading', duration: 500 });
    this.getRandomResumeData();
  },

  goToDetail(event) {
    wx.navigateTo({ url: `/pages/resume/detail?id=${event.currentTarget.dataset.id}` });
  },

  onDescInput(event) {
    this.setData({ userDesc: event.detail.value });
  },

  async ensureOpenId() {
    let openId = app.globalData.openId || wx.getStorageSync('openid');
    if (!openId || openId === 'undefined') {
      const authResult = await app.getWxAuth();
      openId = authResult?.openid;
    }
    return openId || '';
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

  async checkResumeQuota() {
    const openId = await this.ensureOpenId();
    if (!openId) {
      wx.showToast({ title: '用户登录失败', icon: 'none' });
      return false;
    }
    let quotaResult;
    try {
      const response = await this.request({
        url: `${app.globalData.baseUrl}/api/getUserQuota`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: { openId }
      });
      quotaResult = response.data;
    } catch (error) {
      console.error('查询接口异常：', error);
      quotaResult = { code: -1 };
    }
    if (quotaResult.code !== 0) {
      wx.showToast({ title: '获取次数失败', icon: 'none' });
      return false;
    }
    const { resumeFreeLeft, payResumeCount } = quotaResult.data;
    if (resumeFreeLeft > 0 || payResumeCount > 0) return true;
    this.showPaymentModal(openId);
    return false;
  },

  showPaymentModal(openId) {
    wx.showModal({
      title: '啊哈～免费简历诊断次数用完啦',
      content: '本次诊断仅付费0.01元',
      confirmText: '去支付',
      cancelText: '取消',
      success: result => {
        if (result.confirm) this.createPayment(openId);
      }
    });
  },

  async createPayment(openId) {
    let createResult;
    try {
      const response = await this.request({
        url: `${app.globalData.baseUrl}/api/createWxPayOrder`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: { openId, type: 'resume' }
      });
      createResult = response.data;
    } catch (error) {
      console.error('下单网络失败', error);
      wx.showToast({ title: '创建订单失败', icon: 'none' });
      return;
    }
    if (createResult.errcode !== 0 || !createResult.prepay_id || !createResult.payParams) {
      console.error('下单失败详情', createResult);
      wx.showToast({ title: createResult.wxMessage || '创建订单失败', icon: 'none' });
      return;
    }
    wx.requestPayment({
      ...createResult.payParams,
      success: () => this.pollPaidOrder(createResult),
      fail: error => {
        console.error('支付弹窗取消/失败', error);
        wx.showToast({ title: '支付取消或失败', icon: 'none' });
      }
    });
  },

  pollPaidOrder(createResult) {
    wx.showLoading({ title: '从聊天选取简历即可' });
    this.pollCount = 0;
    this.setData({ isPolling: true });
    this._pollTimer = setInterval(async () => {
      if (!this._pollTimer) return;
      this.pollCount += 1;
      let orderResult = { errcode: -1 };
      try {
        const response = await this.request({
          url: `${app.globalData.baseUrl}/api/queryPayOrder`,
          method: 'POST',
          header: { 'Content-Type': 'application/json' },
          data: { out_trade_no: createResult.out_trade_no }
        });
        orderResult = response.data;
      } catch (error) {
        console.error('订单查询失败', error);
      }
      if (!this._pollTimer) return;
      if (orderResult.errcode === 0 && orderResult.trade_state === 'SUCCESS') {
        this.clearOrderPolling();
        wx.hideLoading();
        wx.showToast({ title: '支付成功', icon: 'success' });
        this.openFile();
      } else if (this.pollCount >= 5) {
        this.clearOrderPolling();
        wx.hideLoading();
        wx.showToast({ title: '订单同步中，请稍后重试', icon: 'none', duration: 3000 });
      }
    }, 2200);
  },

  uploadResume() {
    if (this.data.isPolling || this.data.isSubmitting) {
      wx.showToast({ title: '当前操作正在处理中，请稍候', icon: 'none' });
      return;
    }
    const tipCount = wx.getStorageSync('tip') || 0;
    if (tipCount < 2) {
      wx.showModal({
        title: '上传提示',
        content: '从聊天选取简历即可',
        showCancel: false,
        success: async () => {
          wx.setStorageSync('tip', tipCount + 1);
          if (await this.checkResumeQuota()) this.openFile();
        }
      });
      return;
    }
    this.checkResumeQuota().then(canUse => {
      if (canUse) this.openFile();
    });
  },

  openFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'all',
      success: result => this.startMockDiagnosis(result.tempFiles?.[0] || {}),
      fail: error => {
        if (String(error?.errMsg || '').includes('cancel')) return;
        wx.showToast({ title: '上传失败', icon: 'error' });
      }
    });
  },

  async startMockDiagnosis(selectedFile) {
    if (this.data.isSubmitting) return;
    this.setData({
      isSubmitting: true,
      isAnalyzing: true,
      analyzingText: '大厂专家的分身正在赶来的路上'
    });
    this.startWaitingCopyTimers();
    try {
      const openid = await this.ensureOpenId();
      if (!openid) throw new Error('用户登录失败');
      const prepared = buildMockResume(selectedFile);
      const response = await this.request({
        url: `${app.globalData.baseUrl}/api/diagnose/tasks`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: {
          openid,
          resumeInfo: prepared.resumeInfo,
          jobTarget: this.data.userDesc,
          customPrompt: '',
          resume_id: prepared.resume_id
        }
      });
      if (![200, 202].includes(response.statusCode) || response.data?.code !== 0) {
        throw new Error(response.data?.msg || '诊断任务创建失败');
      }
      const taskId = response.data.data?.task_id;
      if (!taskId) throw new Error('诊断任务编号缺失');
      this._diagnoseTaskId = taskId;
      this._diagnoseOpenId = openid;
      this.startDiagnosisPolling();
    } catch (error) {
      console.error('创建诊断任务失败', error);
      this.finishAnalyzing();
      this.showFailureModal(error.message || '诊断任务创建失败，请稍后重试');
    }
  },

  startDiagnosisPolling() {
    this.stopDiagnosisPolling();
    this._diagnosePolling = true;
    this.pollDiagnosisTask();
  },

  stopDiagnosisPolling() {
    this._diagnosePolling = false;
    if (this._diagnosePollTimer) clearTimeout(this._diagnosePollTimer);
    this._diagnosePollTimer = null;
  },

  async pollDiagnosisTask() {
    if (!this._diagnosePolling || !this._diagnoseTaskId) return;
    try {
      const response = await this.request({
        url: `${app.globalData.baseUrl}/api/diagnose/tasks/${encodeURIComponent(this._diagnoseTaskId)}`,
        method: 'GET',
        data: { openid: this._diagnoseOpenId, after_seq: 0, limit: 1 }
      });
      const task = response.data?.data;
      if (response.statusCode !== 200 || response.data?.code !== 0 || !task) {
        throw new Error(response.data?.msg || '诊断进度查询失败');
      }
      if (task.status === 'succeeded' || task.chunks?.length > 0) {
        this.openReport();
        return;
      }
      if (task.status === 'failed' || task.status === 'cancelled') {
        this.stopDiagnosisPolling();
        this.finishAnalyzing();
        this.showFailureModal(this.diagnosisErrorMessage(task));
        return;
      }
    } catch (error) {
      // 单次网络失败不等于模型失败，保留任务并继续轮询。
      console.error('诊断轮询暂时失败', error);
    }
    if (this._diagnosePolling) {
      this._diagnosePollTimer = setTimeout(() => this.pollDiagnosisTask(), POLL_INTERVAL_MS);
    }
  },

  diagnosisErrorMessage(task) {
    if (task.error_code === 'FIRST_TOKEN_TIMEOUT') {
      return '晕，专家突然被拉进一个临时会议。你稍后重试就行';
    }
    if (task.error_code === 'STREAM_STUCK') {
      return '晕，结论还没写完就被一个会议打断了。你稍后重试就行。';
    }
    return task.error_message || '诊断暂时没有完成，请稍后重试';
  },

  finishAnalyzing() {
    this.stopDiagnosisPolling();
    this.clearWaitingCopyTimers();
    this.setData({
      isAnalyzing: false,
      isSubmitting: false,
      analyzingText: '大厂专家的分身正在赶来的路上'
    });
  },

  openReport() {
    const taskId = this._diagnoseTaskId;
    const openid = this._diagnoseOpenId;
    this.finishAnalyzing();
    wx.navigateTo({
      url: `/pages/resume/report?taskId=${encodeURIComponent(taskId)}&openid=${encodeURIComponent(openid)}`,
      fail: error => {
        console.error('进入报告页失败', error);
        this.showFailureModal('报告页面打开失败，请稍后重试');
      }
    });
  },

  showFailureModal(message) {
    wx.showModal({
      title: '诊断中断',
      content: message,
      showCancel: false,
      confirmText: '我知道了'
    });
  }
});
