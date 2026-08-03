'use strict';

const { db, withTimeout } = require('./diagnose-db');

const MAX_PROMPT_CHAR_LEN = 35000;
const MAX_CONTENT_LENGTH = 200000;
const FIRST_TOKEN_WAIT_NOTICE_MS = 20 * 1000;
const FIRST_TOKEN_WAIT_MS = 45 * 1000;
const WHOLE_STREAM_MAX_MS = 120 * 1000;

function createDiagnosisError(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function safeString(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value || {});
}

function parseSseBlocks(buffer) {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const blocks = normalized.split(/\n\n/);
  return {
    completeBlocks: blocks.slice(0, -1),
    remainder: blocks[blocks.length - 1] || ''
  };
}

function getDataPayload(block) {
  const dataLines = block
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.replace(/^data:\s?/, ''));
  return dataLines.length > 0 ? dataLines.join('\n').trim() : null;
}

async function loadPrompt() {
  const promptRes = await withTimeout(
    db.collection('prompt_version')
      .where({ status: 'online', version_code: 'V_final' })
      .limit(1)
      .get(),
    3000,
    'PROMPT_QUERY_TIMEOUT'
  );

  const dbPrompt = promptRes.data?.[0]?.full_prompt_text ?? '';
  console.log('【诊断】Prompt查询完成，命中条数：', promptRes.data?.length || 0, '文本长度：', dbPrompt.length);
  if (typeof dbPrompt !== 'string' || !dbPrompt.trim()) {
    throw createDiagnosisError('PROMPT_TEMPLATE_LOAD_FAILED');
  }
  return dbPrompt;
}

function validateModelConfig() {
  const modelUrl = process.env.MODEL_STREAM_API_URL;
  const modelEndpoint = process.env.ARK_MODEL_ENDPOINT;
  const apiKey = process.env.VOLC_ACCESS_KEY;

  if (!modelUrl || !modelEndpoint) {
    throw createDiagnosisError('VOLC_CONFIG_MISSING');
  }
  if (!apiKey || !apiKey.trim()) {
    throw createDiagnosisError('VOLC_KEY_MISSING');
  }

  return { modelUrl, modelEndpoint, apiKey: apiKey.trim() };
}

function validateResult(fullRawStr) {
  if (!fullRawStr.trim()) throw createDiagnosisError('MODEL_EMPTY_RESPONSE');
  if (fullRawStr.length > MAX_CONTENT_LENGTH) {
    throw createDiagnosisError('MODEL_RESPONSE_TOO_LARGE');
  }

  let parsed;
  try {
    parsed = JSON.parse(fullRawStr);
  } catch (error) {
    console.error('【模型JSON解析失败】返回前500字：', fullRawStr.slice(0, 500));
    throw createDiagnosisError('MODEL_JSON_INVALID', error);
  }

  const requiredFields = ['overview', 'advantages', 'improve', 'optimize_ref'];
  for (const field of requiredFields) {
    if (!(field in parsed)) throw createDiagnosisError('MODEL_JSON_MISSING_FIELD');
  }
  return parsed;
}

/**
 * Runs the already-proven Volc Ark streaming request independently of HTTP.
 * Callback functions may be async; only onChunk is intentionally not awaited so
 * callers can buffer tokens and persist them in batches.
 */
async function runResumeDiagnosis(input, callbacks = {}, options = {}) {
  const abortCtrl = new AbortController();
  const externalSignal = options.signal;
  let abortReason = null;
  let firstTokenNoticeTimer = null;
  let firstTokenTimer = null;
  let wholeStreamTimer = null;
  let externalAbortHandler = null;
  let hasFirstToken = false;
  let firstTokenAt = null;
  let fullRawStr = '';
  let buffer = '';
  const firstTokenNoticeMs = options.firstTokenWaitNoticeMs ?? FIRST_TOKEN_WAIT_NOTICE_MS;
  const firstTokenWaitMs = options.firstTokenWaitMs ?? FIRST_TOKEN_WAIT_MS;
  const wholeStreamMaxMs = options.wholeStreamMaxMs ?? WHOLE_STREAM_MAX_MS;

  const abortWithReason = reason => {
    if (abortCtrl.signal.aborted) return;
    abortReason = reason;
    abortCtrl.abort();
  };

  try {
    if (externalSignal) {
      externalAbortHandler = () => abortWithReason(options.getAbortReason?.() || 'TASK_ABORTED');
      if (externalSignal.aborted) externalAbortHandler();
      else externalSignal.addEventListener('abort', externalAbortHandler, { once: true });
    }

    const dbPrompt = await loadPrompt();
    const resumeInfo = safeString(input.resumeInfo);
    const jobTarget = safeString(input.jobTarget);
    const fullUserInput = JSON.stringify({
      resumeInfo,
      jobTarget,
      customPrompt: input.customPrompt
    });

    if (dbPrompt.length + fullUserInput.length > MAX_PROMPT_CHAR_LEN) {
      throw createDiagnosisError('PROMPT_TOO_LONG');
    }

    const { modelUrl, modelEndpoint, apiKey } = validateModelConfig();
    const modelRequestParams = {
      model: modelEndpoint,
      stream: true,
      messages: [
        { role: 'system', content: dbPrompt },
        { role: 'user', content: `简历求职信息：${fullUserInput}` }
      ]
    };

    const modelStartedAt = Date.now();
    await callbacks.onModelStart?.({ modelStartedAt });

    firstTokenNoticeTimer = setTimeout(() => {
      if (!hasFirstToken && !abortCtrl.signal.aborted) {
        Promise.resolve(callbacks.onWaiting?.({ elapsedSec: 20 })).catch(error => {
          console.error('【诊断进度回调失败】', error);
        });
      }
    }, firstTokenNoticeMs);

    firstTokenTimer = setTimeout(() => {
      if (!hasFirstToken) abortWithReason('FIRST_TOKEN_TIMEOUT');
    }, firstTokenWaitMs);

    wholeStreamTimer = setTimeout(() => abortWithReason('STREAM_STUCK'), wholeStreamMaxMs);

    const fetchRes = await fetch(modelUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(modelRequestParams),
      signal: abortCtrl.signal
    });

    console.log('【火山响应】HTTP状态：', fetchRes.status, fetchRes.statusText);
    if (!fetchRes.ok) {
      const responseText = await fetchRes.text();
      console.error('【火山调用失败】', fetchRes.status, responseText.slice(0, 2000));
      throw createDiagnosisError(`MODEL_HTTP_ERROR_${fetchRes.status}`);
    }
    if (!fetchRes.body) throw createDiagnosisError('MODEL_EMPTY_BODY');

    const reader = fetchRes.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let sawDone = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsedBlocks = parseSseBlocks(buffer);
      buffer = parsedBlocks.remainder;

      for (const block of parsedBlocks.completeBlocks) {
        const payload = getDataPayload(block);
        if (!payload) continue;
        if (payload === '[DONE]') {
          sawDone = true;
          continue;
        }

        let chunkJson;
        try {
          chunkJson = JSON.parse(payload);
        } catch (error) {
          console.error('【SSE JSON解析失败】', payload.slice(0, 300));
          continue;
        }

        const deltaText = chunkJson?.choices?.[0]?.delta?.content || '';
        if (!deltaText) continue;
        if (fullRawStr.length + deltaText.length > MAX_CONTENT_LENGTH) {
          abortWithReason('MODEL_RESPONSE_TOO_LARGE');
          throw createDiagnosisError('MODEL_RESPONSE_TOO_LARGE');
        }

        fullRawStr += deltaText;
        if (!hasFirstToken) {
          hasFirstToken = true;
          firstTokenAt = Date.now();
          clearTimeout(firstTokenNoticeTimer);
          clearTimeout(firstTokenTimer);
          firstTokenNoticeTimer = null;
          firstTokenTimer = null;
          await callbacks.onFirstToken?.({ firstTokenAt });
        }
        callbacks.onChunk?.(deltaText);
      }
    }

    buffer += decoder.decode();
    // 120秒只约束模型流。流已经正常结束后，不让后续批量落片、校验和入库被误杀。
    if (wholeStreamTimer) {
      clearTimeout(wholeStreamTimer);
      wholeStreamTimer = null;
    }
    // Ark normally sends [DONE]. A clean EOF with a complete, valid JSON body is
    // accepted as an equivalent terminal signal for compatibility.
    const parsedResult = validateResult(fullRawStr);
    const streamFinishedAt = Date.now();
    await callbacks.onComplete?.({ sawDone, streamFinishedAt });

    return {
      parsedResult,
      fullRawStr,
      modelStartedAt,
      firstTokenAt,
      streamFinishedAt,
      timeToFirstTokenSec: Number(((firstTokenAt - modelStartedAt) / 1000).toFixed(2)),
      totalModelCostSec: Number(((streamFinishedAt - modelStartedAt) / 1000).toFixed(2))
    };
  } catch (error) {
    if (abortReason) throw createDiagnosisError(abortReason, error);
    throw error;
  } finally {
    if (firstTokenNoticeTimer) clearTimeout(firstTokenNoticeTimer);
    if (firstTokenTimer) clearTimeout(firstTokenTimer);
    if (wholeStreamTimer) clearTimeout(wholeStreamTimer);
    if (externalSignal && externalAbortHandler) {
      externalSignal.removeEventListener('abort', externalAbortHandler);
    }
  }
}

module.exports = {
  FIRST_TOKEN_WAIT_NOTICE_MS,
  FIRST_TOKEN_WAIT_MS,
  WHOLE_STREAM_MAX_MS,
  createDiagnosisError,
  runResumeDiagnosis
};
