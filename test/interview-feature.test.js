'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

test('interview route, prompt and isolated collections are wired', () => {
  const router = fs.readFileSync('routes/index.js', 'utf8');
  const service = fs.readFileSync('routes/interview-service.js', 'utf8');
  const worker = fs.readFileSync('routes/interview-worker.js', 'utf8');
  assert.match(router, /router\.use\('\/interview', interviewRouter\)/);
  assert.match(service, /version_code: 'V_interview_final'/);
  for (const collection of ['interview_task', 'interview_task_chunk', 'interview_result', 'interview_quota_ledger']) assert.match(worker + fs.readFileSync('routes/interview.js', 'utf8'), new RegExp(collection));
});

test('interview frontend never invokes legacy quota deduction', () => {
  const source = fs.readFileSync('pages/interview/interview.js', 'utf8');
  assert.doesNotMatch(source, /deductQuota|_deduct/);
  assert.match(source, /\/interview\/tasks/);
  assert.match(source, /uploadResumeFile/);
});

test('advice page renders fixed schema and foldable answers', () => {
  const js = fs.readFileSync('pages/advice/advice.js', 'utf8');
  const wxml = fs.readFileSync('pages/advice/advice.wxml', 'utf8');
  assert.match(js, /TYPE_INTERVAL_MS = 40/);
  assert.match(js, /TYPE_STEP = 8/);
  assert.match(wxml, /item\.thinking/);
  assert.match(wxml, /toggleFold/);
  assert.match(wxml, /报告持续生成中/);
});

test('interview schema accepts complete ok output and rejects populated invalid output', () => {
  const { validateInterviewSchema } = require('../routes/interview-service');
  const guide = { selfIntro: 'a', projectRule: 'b', interviewHabit: 'c' };
  const questions = Array.from({ length: 7 }, (_, index) => ({ title: `q${index}`, thinking: 'direction', sampleAnswer: 'answer' }));
  assert.doesNotThrow(() => validateInterviewSchema({ status: 'ok', brief_summary: '', profileOverview: 'profile', keyExaminePoint: ['point'], matchAdvice: 'advice', interviewSkillGuide: guide, questionList: questions }));
  assert.throws(() => validateInterviewSchema({ status: 'all_invalid', brief_summary: 'tip', profileOverview: 'must be empty', keyExaminePoint: [], matchAdvice: '', interviewSkillGuide: { selfIntro: '', projectRule: '', interviewHabit: '' }, questionList: [] }));
});

test('interview page preserves the approved copy and readable style source', () => {
  const wxml = fs.readFileSync('pages/interview/interview.wxml', 'utf8');
  const wxss = fs.readFileSync('pages/interview/interview.wxss', 'utf8');
  assert.match(wxml, /我目前在校专业City Technology MKT，有过1段实习经历/);
  assert.match(wxml, /无简历, 直接获取面经/);
  assert.ok(wxss.split('\n').length > 100, 'interview.wxss should remain readable and multiline');
  assert.match(wxss, /width: 100% !important;/);
  assert.match(wxss, /transition: all 0\.2s ease;/);
});

test('advice styles remain readable and retain the original visual structure', () => {
  const wxss = fs.readFileSync('pages/advice/advice.wxss', 'utf8');
  assert.ok(wxss.split('\n').length > 150, 'advice.wxss should remain readable and multiline');
  assert.match(wxss, /box-shadow: 0 6rpx 20rpx rgba\(0, 0, 0, 0\.04\)/);
  assert.match(wxss, /\.demo-collapsed/);
});

test('interview and advice pages preserve the latest approved user-facing copy', () => {
  const interview = fs.readFileSync('pages/interview/interview.js', 'utf8');
  const advice = fs.readFileSync('pages/advice/advice.js', 'utf8');
  assert.match(interview, /请从聊天记录选择简历/);
  assert.match(interview, /填一下面试信息/);
  assert.match(interview, /再等等，专家们正在整理干货/);
  assert.match(interview, /马上完成，HR正在做针对性的调整/);
  assert.match(advice, /面经的核心题库被卡住了，稍后重试即可/);
});

test('advice consumes incremental chunks and only finishes after backend success', () => {
  const source = fs.readFileSync('pages/advice/advice.js', 'utf8');
  assert.match(source, /for \(const chunk of task\.chunks \|\| \[\]\)/);
  assert.match(source, /parseStreamingAdvice\(this\.rawChunks\)/);
  assert.match(source, /this\.backendSucceeded = true/);
  assert.match(source, /complete && this\.backendSucceeded/);
  assert.match(source, /normalizeAdvice\(task\.result\)/);
});

test('interview waits for safe display content before opening the advice page', () => {
  const source = fs.readFileSync('pages/interview/interview.js', 'utf8');
  assert.match(source, /after_seq: this\._adviceAfterSeq/);
  assert.match(source, /parseStreamingAdvice\(this\._adviceRawChunks\)/);
  assert.match(source, /task\.status === 'succeeded' \|\| hasAdviceContent\(preview\)/);
  assert.doesNotMatch(source, /task\.status === 'succeeded' \|\| task\.chunks\?\.length > 0/);
});
