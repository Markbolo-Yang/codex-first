'use strict';

Component({
  data: {
    selected: 0,
    color: '#666666',
    selectedColor: '#1677ff',
    list: [
      { pagePath: '/pages/resume/resume', text: '简历诊断', iconPath: '/images/tab/resume.png', selectedIconPath: '/images/tab/resume_active.png' },
      { pagePath: '/pages/interview/interview', text: '面试辅导', iconPath: '/images/tab/interview.png', selectedIconPath: '/images/tab/interview_active.png' },
      { pagePath: '/pages/mentor/mentor', text: '真人导师', iconPath: '/images/tab/mentor.png', selectedIconPath: '/images/tab/mentor_active.png', hot: true },
      { pagePath: '/pages/mine/mine', text: '我的', iconPath: '/images/tab/mine.png', selectedIconPath: '/images/tab/mine_active.png' }
    ]
  },

  lifetimes: {
    attached() {
      this.syncSelected();
    }
  },

  methods: {
    syncSelected() {
      const pages = getCurrentPages();
      const currentRoute = pages[pages.length - 1]?.route;
      const selected = this.data.list.findIndex(item => item.pagePath.slice(1) === currentRoute);
      if (selected >= 0 && selected !== this.data.selected) this.setData({ selected });
    },

    switchTab(event) {
      const { path, index } = event.currentTarget.dataset;
      if (index === this.data.selected) return;
      this.setData({ selected: index });
      wx.switchTab({ url: path });
    }
  }
});
