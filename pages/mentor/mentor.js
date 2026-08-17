'use strict';

const CUSTOMER_SERVICE_URL = 'https://work.weixin.qq.com/kfid/kfceaf821d31a2800b3';

Page({
  data: {
    categoryList: ['求职规划辅导', '模拟面试辅导', '简历手把手优化', '岗位专业知识辅导'],
    selectedCategory: '',
    pickerValue: '',
    userDesc: '',
    showTip: false,
    tipText: '',
    mentorOffset: 0,
    scrollTimer: null,
    mentorList: []
  },

  shuffleArray(arr) {
    const newArr = [...arr];
    for (let index = newArr.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [newArr[index], newArr[randomIndex]] = [newArr[randomIndex], newArr[index]];
    }
    return newArr;
  },

  onShow() {
    const app = getApp();
    this.showMentorHotBadge();
    this.stopMentorScroll();

    if (app.globalData.fromReportPage) {
      this.selectCategory(2);
      app.globalData.fromReportPage = false;
    }

    try {
      const defaultType = wx.getStorageSync('mentorDefaultType');
      const categoryIndexByType = {
        careerPlanning: 0,
        mockInterview: 1
      };
      if (Object.prototype.hasOwnProperty.call(categoryIndexByType, defaultType)) {
        this.selectCategory(categoryIndexByType[defaultType]);
        wx.removeStorageSync('mentorDefaultType');
      }
    } catch (error) {
      console.warn('读取导师默认辅导类型失败', error);
    }

    this.getCloudMentorData();
  },

  showMentorHotBadge() {
    wx.setTabBarBadge({
      index: 2,
      text: 'HOT',
      fail: error => console.warn('真人导师HOT标识展示失败', error)
    });
  },

  selectCategory(index) {
    this.setData({
      pickerValue: index,
      selectedCategory: this.data.categoryList[index]
    });
  },

  stopMentorScroll() {
    if (this.data.scrollTimer) clearInterval(this.data.scrollTimer);
    this.setData({ scrollTimer: null });
  },

  getCloudMentorData() {
    const db = wx.cloud.database();
    db.collection('mentor_info').get().then(result => {
      const mentorList = this.shuffleArray(result.data);
      this.setData({ mentorList });
      if (mentorList.length > 0) this.startScroll();
    }).catch(error => console.error('读取导师信息失败', error));
  },

  startScroll() {
    this.stopMentorScroll();
    const itemWidth = 120;
    const length = this.data.mentorList.length;
    if (length === 0) return;

    let mentorOffset = this.data.mentorOffset - itemWidth;
    if (Math.abs(mentorOffset) >= itemWidth * length) mentorOffset = 0;
    this.setData({ mentorOffset });

    const scrollTimer = setInterval(() => {
      let nextOffset = this.data.mentorOffset - itemWidth;
      if (Math.abs(nextOffset) >= itemWidth * length) nextOffset = 0;
      this.setData({ mentorOffset: nextOffset });
    }, 3200);
    this.setData({ scrollTimer });
  },

  onUnload() {
    this.stopMentorScroll();
  },

  onCategoryChange(event) {
    this.selectCategory(Number(event.detail.value));
  },

  onDescInput(event) {
    this.setData({ userDesc: event.detail.value });
  },

  submit() {
    const { selectedCategory, userDesc } = this.data;
    if (!selectedCategory || !userDesc) {
      wx.showToast({ title: '请填写完整需求', icon: 'none' });
      return;
    }

    const infoText = `【诉求方向】${selectedCategory}\n【当前处境】${userDesc}`;
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    const createTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    wx.cloud.database().collection('user_consult').add({
      data: {
        nickName: '匿名用户',
        consultType: selectedCategory,
        content: userDesc,
        createTime,
        status: 'pending',
        remark: ''
      }
    }).catch(error => console.log('入库异常', error));

    wx.setClipboardData({
      data: infoText,
      showToast: false
    });

    this.setData({ showTip: true, tipText: '诉求已复制，可一键粘贴发送' });
    setTimeout(() => this.setData({ showTip: false }), 3800);

    wx.openCustomerServiceChat({
      corpId: 'ww639b4917bebfa484',
      extInfo: { url: CUSTOMER_SERVICE_URL },
      success: () => console.log('唤起客服成功'),
      fail: error => console.error('唤起客服失败', error)
    });
  }
});
