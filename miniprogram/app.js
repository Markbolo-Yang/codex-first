'use strict';

App({
  globalData: {
    fromReportPage: false,
    baseUrl: 'https://api.youwantoffer.cn',
    openId: ''
  },

  onLaunch() {
    wx.cloud.init({
      env: 'cloud1-d7gnifk2zb5241a23',
      traceUser: true
    });
    const cacheOpen = wx.getStorageSync('openid');
    if (cacheOpen && cacheOpen !== 'undefined') {
      this.globalData.openId = cacheOpen;
    }
  },

  onShow() {},
  onHide() {},

  formatDateTime(timestamp) {
    const date = new Date(timestamp);
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  },

  async getWxAuth() {
    let openid = wx.getStorageSync('openid');
    if (openid && openid !== 'undefined') {
      this.globalData.openId = openid;
      try {
        const db = wx.cloud.database();
        const now = Date.now();
        const nowStr = this.formatDateTime(now);
        const userCheck = await db.collection('users').where({ openid }).get();
        if (userCheck.data.length === 0) {
          await db.collection('users').add({
            data: {
              openid,
              createdAt: now,
              createTimeStr: nowStr,
              lastLoginAt: now,
              lastLoginStr: nowStr,
              resumeFreeLeft: 2,
              interviewFreeLeft: 2,
              payResumeCount: 0,
              payInterviewCount: 0
            }
          });
        } else {
          const existingUser = userCheck.data[0];
          const userPatch = {
            lastLoginAt: now,
            lastLoginStr: nowStr
          };
          if (existingUser.payResumeCount == null) userPatch.payResumeCount = 0;
          if (existingUser.payInterviewCount == null) userPatch.payInterviewCount = 0;
          await db.collection('users').where({ openid }).update({
            data: userPatch
          });
        }
      } catch (error) {
        console.warn('用户数据同步失败', error);
      }
      return { openid };
    }

    try {
      const loginRes = await new Promise((resolve, reject) => wx.login({ success: resolve, fail: reject }));
      if (!loginRes.code) throw new Error('无登录code');
      const apiRes = await new Promise((resolve, reject) => wx.request({
        url: `${this.globalData.baseUrl}/api/getOpenId`,
        data: { code: loginRes.code },
        success: resolve,
        fail: reject
      }));
      const result = apiRes.data;
      if (result.code !== 0 || !result.openId) throw new Error('后端返回异常');
      openid = result.openId;

      wx.setStorageSync('openid', openid);
      this.globalData.openId = openid;

      const db = wx.cloud.database();
      const userRes = await db.collection('users').where({ openid }).get();
      const now = Date.now();
      const nowStr = this.formatDateTime(now);
      if (userRes.data.length === 0) {
        await db.collection('users').add({
          data: {
            openid,
            createdAt: now,
            createTimeStr: nowStr,
            lastLoginAt: now,
            lastLoginStr: nowStr,
            resumeFreeLeft: 2,
            interviewFreeLeft: 2,
            payResumeCount: 0,
            payInterviewCount: 0
          }
        });
      } else {
        const existingUser = userRes.data[0];
        const userPatch = {
          lastLoginAt: now,
          lastLoginStr: nowStr
        };
        if (existingUser.payResumeCount == null) userPatch.payResumeCount = 0;
        if (existingUser.payInterviewCount == null) userPatch.payInterviewCount = 0;
        await db.collection('users').doc(userRes.data[0]._id).update({
          data: userPatch
        });
      }
      return { openid };
    } catch (error) {
      console.error('鉴权失败', error);
      return null;
    }
  },

  async requestUserInfo(type) {
    let openId = this.globalData.openId || wx.getStorageSync('openid');
    if (!openId || openId === 'undefined') {
      await this.getWxAuth();
      openId = this.globalData.openId || wx.getStorageSync('openid');
      if (!openId) return { code: -99, msg: '获取用户身份失败' };
    }
    return new Promise(resolve => {
      wx.request({
        url: `${this.globalData.baseUrl}/api/getUserData`,
        data: { openId, type },
        success: response => resolve(response.data),
        fail: error => resolve({ code: -98, msg: '接口请求异常', err: error })
      });
    });
  }
});
