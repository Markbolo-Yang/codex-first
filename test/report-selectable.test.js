'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const reportTemplate = fs.readFileSync(
  path.join(__dirname, '../pages/resume/report.wxml'),
  'utf8'
);

const reportBindings = [
  '{{report.overview}}',
  '{{advantage}}',
  '{{point}}',
  '{{project.project_name}}',
  "{{reference.project_name || '优化建议'}}",
  '原文：{{reference.original_text}}',
  '{{reference.optimize_content}}'
];

test('all generated report text supports long-press selection', () => {
  for (const binding of reportBindings) {
    const escapedBinding = binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const selectableText = new RegExp(
      `<text[^>]*selectable="true"[^>]*user-select="true"[^>]*>[^<]*${escapedBinding}`
    );
    assert.match(reportTemplate, selectableText, `${binding} should be selectable`);
  }
});
