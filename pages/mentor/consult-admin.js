'use strict';

const app = getApp();
const PAGE_SIZE = 20;

Page({
  data: {
    statusOptions: [
      { label: '待处理', value: 'pending' },
      { label: '已处理', value: 'processed' },
      { label: '全部', value: 'all' }
    ],
    statusIndex: 0,
    consultList: [],
    page: 0,
    hasMore: true,
    loading: false,
    errorMessage: ''
  },

  onLoad() {
    this.loadConsults(true);
  },

  onPullDownRefresh() {
    this.loadConsults(true).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore) this.loadConsults(false);
  },

  onStatusChange(event) {
    this.setData({ statusIndex: Number(event.detail.value) });
    this.loadConsults(true);
  },

  onRemarkInput(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ [`consultList[${index}].remark`]: event.detail.value });
  },

  loginCode() {
    return new Promise((resolve, reject) => {
      wx.login({
        success: result => result.code ? resolve(result.code) : reject(new Error('微信登录凭证获取失败')),
        fail: reject
      });
    });
  },

  request(options) {
    return new Promise((resolve, reject) => {
      wx.request({
        ...options,
        success: response => {
          if (response.statusCode === 200 && response.data?.code === 0) resolve(response.data.data);
          else reject(new Error(response.data?.msg || '请求失败'));
        },
        fail: reject
      });
    });
  },

  async loadConsults(reset) {
    if (this.data.loading) return;
    const page = reset ? 0 : this.data.page;
    const status = this.data.statusOptions[this.data.statusIndex].value;
    this.setData({ loading: true, errorMessage: reset ? '' : this.data.errorMessage });

    try {
      const code = await this.loginCode();
      const data = await this.request({
        url: `${app.globalData.baseUrl}/api/admin/consults/list`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: { code, status, page, pageSize: PAGE_SIZE }
      });
      this.setData({
        consultList: reset ? data.list : this.data.consultList.concat(data.list),
        page: page + 1,
        hasMore: data.hasMore,
        loading: false,
        errorMessage: ''
      });
    } catch (error) {
      this.setData({ loading: false, errorMessage: error.message || '加载失败' });
    }
  },

  async markProcessed(event) {
    const index = Number(event.currentTarget.dataset.index);
    const consult = this.data.consultList[index];
    if (!consult || consult._submitting) return;
    this.setData({ [`consultList[${index}]._submitting`]: true });

    try {
      const code = await this.loginCode();
      await this.request({
        url: `${app.globalData.baseUrl}/api/admin/consults/${encodeURIComponent(consult._id)}/process`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: { code, remark: consult.remark || '' }
      });
      wx.showToast({ title: '已标记处理', icon: 'success' });
      this.loadConsults(true);
    } catch (error) {
      this.setData({ [`consultList[${index}]._submitting`]: false });
      wx.showToast({ title: error.message || '操作失败', icon: 'none' });
    }
  }
});
