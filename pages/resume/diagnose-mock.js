'use strict';

// 仅用于前端异步诊断链路联调。接入真实 PDF/DOCX 解析后删除本文件。
const MOCK_RESUME_INFO = `
双一流高校电子商务专业本科，GPA 3.8/4.0，专业排名前 7%，预计 2027 年毕业。

在校期间修读产品设计、用户研究、数据分析、消费者行为学、计算机基础、交互设计等课程，具备产品需求分析、用户研究、数据分析和项目推进方面的基础能力。

曾担任学校产品协会会长，负责协会活动策划、成员管理和项目推进。牵头完成校园二手交易小程序项目，担任产品负责人，参与用户访谈、竞品分析、需求整理、产品原型设计、研发沟通、功能测试及版本复盘。项目获得省级大学生创新创业大赛一等奖。

拥有三段互联网产品相关实习经历。第一段为社交 App 产品实习，参与评论区风控与举报流程优化，新流程上线后举报处理效率提升约 42%。第二段为效率工具小程序产品实习，参与待办清单和多人协作模块从零到一的产品建设，结合埋点数据完成三轮版本迭代，产品 30 日留存率提升约 18%。第三段为互联网大厂用户研究岗位实习，参与用户访谈、问卷设计、竞品拆解、需求池整理和研究结论输出。

熟悉 Axure、Figma、墨刀、XMind、飞书项目等产品工具，能够使用 SQL 和 Excel 进行基础数据分析，了解 A/B 测试、灰度发布、需求优先级管理和产品版本迭代流程。求职目标为互联网大厂校招 C 端产品经理，希望重点从事社交产品、效率工具、用户研究、功能迭代和用户增长方向的工作。
`.trim();

function buildMockResume(selectedFile) {
  const file = selectedFile || {};
  return {
    resumeInfo: MOCK_RESUME_INFO,
    resume_id: `mock_resume_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
    fileName: file.name || '产品经理测试简历.pdf',
    isMock: true
  };
}

module.exports = {
  MOCK_RESUME_INFO,
  buildMockResume
};
