'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseStreamingReport,
  normalizeReport,
  hasReportContent,
  advanceReportDisplay
} = require('../pages/resume/diagnose-stream-parser');

test('turns incomplete diagnosis JSON into natural progressive report fields', () => {
  const overview = parseStreamingReport('{"overview":"先整体剖析一下基本情况');
  assert.equal(overview.overview, '先整体剖析一下基本情况');
  assert.equal(hasReportContent(overview), true);

  const advantages = parseStreamingReport(
    '{"overview":"概况","advantages":["优势一","优势二正在生成'
  );
  assert.deepEqual(advantages.advantages, ['优势一', '优势二正在生成']);
  assert.equal(JSON.stringify(advantages).includes('"advantages":['), true);
});

test('reveals a large streamed snapshot with a bounded typewriter budget', () => {
  const target = normalizeReport({
    overview: '这是一段不会整块跳出的简历概况文字',
    advantages: ['第一条优势']
  });
  const first = advanceReportDisplay({}, target, 4);
  assert.equal(first.report.overview, '这是一段');
  assert.equal(first.report.advantages.length, 0);
  assert.equal(first.done, false);

  let current = first.report;
  let steps = 1;
  while (steps < 100) {
    const next = advanceReportDisplay(current, target, 4);
    current = next.report;
    steps += 1;
    if (next.done) break;
  }
  assert.deepEqual(current, target);
  assert.ok(steps > 2);
});

test('normalizes final model result and ignores malformed partial keys', () => {
  assert.equal(parseStreamingReport('{"over'), null);
  const report = normalizeReport({
    overview: '概况',
    advantages: ['优势'],
    improve: {
      base_info: ['基础问题'],
      projects: [{ project_name: '项目一', points: ['项目问题'] }]
    },
    optimize_ref: [{
      project_name: '项目一',
      original_text: '旧内容',
      optimize_content: '新内容'
    }]
  });
  assert.equal(report.improve.projects[0].points[0], '项目问题');
  assert.equal(report.optimize_ref[0].optimize_content, '新内容');
});
