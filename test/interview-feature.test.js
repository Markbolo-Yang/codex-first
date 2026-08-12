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
