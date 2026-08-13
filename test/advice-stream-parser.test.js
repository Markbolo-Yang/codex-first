'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeAdvice,
  parseStreamingAdvice,
  hasAdviceContent
} = require('../pages/advice/advice-stream-parser');

test('parses safe interview content before the model JSON is complete', () => {
  const partial = '<thinking>internal only</thinking>{"status":"ok","brief_summary":"","profileOverview":"软件工程应届生，具备AI接口项目经验","keyExaminePoint":["基础能力","项目表达"],"matchAdvice":"继续';
  const report = parseStreamingAdvice(partial);
  assert.equal(report.profileOverview, '软件工程应届生，具备AI接口项目经验');
  assert.deepEqual(report.keyExaminePoint, ['基础能力', '项目表达']);
  assert.equal(report.matchAdvice, '继续');
  assert.equal(hasAdviceContent(report), true);
});

test('normalizes final API metadata away from the display completion target', () => {
  const result = normalizeAdvice({
    interview_id: 123,
    resume_id: 'resume-1',
    status: 'ok',
    brief_summary: '',
    profileOverview: '背景',
    keyExaminePoint: ['重点'],
    matchAdvice: '建议',
    interviewSkillGuide: {
      selfIntro: '自我介绍',
      projectRule: '项目公式',
      interviewHabit: '面试习惯'
    },
    questionList: [{ title: '问题', thinking: '思路', sampleAnswer: '示范' }]
  });
  assert.deepEqual(Object.keys(result), [
    'profileOverview',
    'keyExaminePoint',
    'matchAdvice',
    'interviewSkillGuide',
    'questionList'
  ]);
});
