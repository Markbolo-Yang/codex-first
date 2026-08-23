'use strict';

const app = getApp();
const PAGE_SIZE = 20;

Page({
  data: {
    orderList: [],
    page: 1,
    pageSize: PAGE_SIZE,
    hasMore: true,
    isLoading: false
  },

  onShow() {
    this.getOrderData(true);
  },

  async onPullDownRefresh() {
    try {
      await this.getOrderData(true);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  onReachBottom() {
    this.loadMoreOrders();
  },

  onOrderListLower() {
    this.loadMoreOrders();
  },

  loadMoreOrders() {
    if (this.data.isLoading || !this.data.hasMore) return;
    this.getOrderData(false);
  },

  async getOrderData(reset = false) {
    if (this.data.isLoading) return;

    let openId = app.globalData.openId || wx.getStorageSync('openid');
    openId = openId ? openId.trim() : '';
    if (!openId || openId === 'undefined') {
      wx.showToast({ title: '用户身份异常', icon: 'none' });
      this.setData({ orderList: [], hasMore: false });
      return;
    }

    const page = reset ? 1 : this.data.page + 1;
    this.setData({ isLoading: true });

    try {
      const result = await new Promise((resolve, reject) => {
        wx.request({
          url: 'https://api.youwantoffer.cn/api/getUserOrderList',
          method: 'POST',
          header: { 'Content-Type': 'application/json' },
          data: { openId, page, pageSize: this.data.pageSize },
          success: response => resolve(response.data),
          fail: reject
        });
      });

      if (result.code !== 0 || !Array.isArray(result.data?.list)) {
        throw new Error(result.msg || '订单列表获取失败');
      }

      const newOrders = result.data.list
        .filter(item => item.data?.openid === openId)
        .map(item => this.formatOrder(item.data));
      const orderList = reset ? newOrders : this.mergeOrders(this.data.orderList, newOrders);

      this.setData({
        orderList,
        page,
        hasMore: Boolean(result.data.hasMore)
      });
    } catch (error) {
      console.error('获取订单列表失败', error);
      if (reset) this.setData({ orderList: [], hasMore: false });
      wx.showToast({ title: '订单加载失败，请稍后重试', icon: 'none' });
    } finally {
      this.setData({ isLoading: false });
    }
  },

  mergeOrders(currentOrders, newOrders) {
    const existingOrderNumbers = new Set(currentOrders.map(item => item.orderNo));
    return currentOrders.concat(newOrders.filter(item => !existingOrderNumbers.has(item.orderNo)));
  },

  formatOrder(order) {
    const statusMap = {
      SUCCESS: { payStatus: 1, statusText: '已完成' },
      NOTPAY: { payStatus: 0, statusText: '未完成' },
      CLOSED: { payStatus: 2, statusText: '已关闭' },
      REFUND: { payStatus: 3, statusText: '已退款' }
    };
    const status = statusMap[order.trade_state] || { payStatus: 0, statusText: '未知状态' };

    return {
      orderNo: order.out_trade_no,
      productName: order.goods_name,
      totalFee: (Number(order.total_fee || 0) / 100).toFixed(2),
      createTime: this.formatTime(order.create_time),
      payStatus: status.payStatus,
      statusText: status.statusText
    };
  },

  formatTime(value) {
    if (!value) return '';
    const date = new Date(String(value).replace(/-/g, '/'));
    if (Number.isNaN(date.getTime())) return value;

    const pad = number => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  },

  goBack() {
    wx.navigateBack();
  }
});
