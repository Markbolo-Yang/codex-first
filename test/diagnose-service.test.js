'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const originalLoad = Module._load;
const originalFetch = global.fetch;

const prompt = '请输出标准JSON';
const fakeDb = {
  command: {},
  collection(name) {
    assert.equal(name, 'prompt_version');
    return {
      where(query) {
        assert.deepEqual(query, { status: 'online', version_code: 'V_final' });
        return this;
      },
      limit() { return this; },
      async get() { return { data: [{ full_prompt_text: prompt }] }; }
    };
  }
};
fakeDb.serverDate = () => new Date();

Module._load = function mockLoad(request, parent, isMain) {
  if (request === '@cloudbase/node-sdk') {
    return { init: () => ({ database: () => fakeDb }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

process.env.MODEL_STREAM_API_URL = 'https://example.invalid/chat/completions';
process.env.ARK_MODEL_ENDPOINT = 'ep-test';
process.env.VOLC_ACCESS_KEY = 'ark-test';

const { FIRST_TOKEN_WAIT_MS, runResumeDiagnosis } = require('../routes/diagnose-service');

test.after(() => {
  Module._load = originalLoad;
  global.fetch = originalFetch;
});

test('uses the product 80-second first-token timeout', () => {
  assert.equal(FIRST_TOKEN_WAIT_MS, 80 * 1000);
});

test('preserves the Ark request shape and assembles a valid streamed diagnosis', async () => {
  const resultJson = JSON.stringify({
    overview: '概览',
    advantages: ['优势'],
    improve: { base_info: ['建议'] },
    optimize_ref: []
  });
  const midpoint = Math.floor(resultJson.length / 2);
  const events = [resultJson.slice(0, midpoint), resultJson.slice(midpoint)]
    .map(content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
    .join('') + 'data: [DONE]\n\n';

  let capturedRequest;
  global.fetch = async (url, options) => {
    capturedRequest = { url, options };
    return new Response(events, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    });
  };

  const chunks = [];
  const result = await runResumeDiagnosis({
    resumeInfo: '测试简历',
    jobTarget: '测试岗位',
    customPrompt: '重点看项目'
  }, {
    onChunk: chunk => chunks.push(chunk)
  });

  assert.equal(capturedRequest.url, process.env.MODEL_STREAM_API_URL);
  assert.equal(capturedRequest.options.headers.Authorization, 'Bearer ark-test');
  const requestBody = JSON.parse(capturedRequest.options.body);
  assert.equal(requestBody.model, 'ep-test');
  assert.equal(requestBody.stream, true);
  assert.equal(requestBody.messages[0].content, prompt);
  assert.equal(requestBody.messages[1].role, 'user');
  assert.equal(chunks.join(''), resultJson);
  assert.deepEqual(result.parsedResult, JSON.parse(resultJson));
  assert.ok(result.firstTokenAt >= result.modelStartedAt);
});

test('aborts with FIRST_TOKEN_TIMEOUT when no valid content arrives', async () => {
  global.fetch = async (url, options) => {
    const stream = new ReadableStream({
      start(controller) {
        const timer = setTimeout(() => controller.close(), 1000);
        options.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          controller.error(new DOMException('aborted', 'AbortError'));
        }, { once: true });
      }
    });
    return new Response(stream, { status: 200 });
  };

  await assert.rejects(
    runResumeDiagnosis({ resumeInfo: '测试简历' }, {}, {
      firstTokenWaitNoticeMs: 5,
      firstTokenWaitMs: 20,
      wholeStreamMaxMs: 100
    }),
    error => error.code === 'FIRST_TOKEN_TIMEOUT'
  );
});
