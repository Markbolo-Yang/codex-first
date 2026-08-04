'use strict';

const crypto = require('crypto');
const { db, cmd, withTimeout } = require('./diagnose-db');
const { runResumeDiagnosis } = require('./diagnose-service');

const POLL_ACTIVE_MS = 750;
const POLL_IDLE_MS = 2500;
const LEASE_MS = 30 * 1000;
const LEASE_RENEW_MS = 10 * 1000;
const CHUNK_FLUSH_MS = 800;
const CHUNK_FLUSH_CHAR_COUNT = 300;
const MAX_ATTEMPTS = 3;

const taskColl = db.collection('diagnose_task');
const chunkColl = db.collection('diagnose_task_chunk');

let workerStarted = false;
let workerStopping = false;
let workerLoopPromise = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createWorkerId() {
  return `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
}

function chunkDocumentId(taskId, seq) {
  return crypto.createHash('sha256').update(`${taskId}:${seq}`).digest('hex').slice(0, 32);
}

function errorDetails(error) {
  const code = error?.code || error?.message || 'MODEL_ERROR';
  const messages = {
    FIRST_TOKEN_TIMEOUT: '晕，分析突然被一个会议强行打断了。你稍后重试就行',
    STREAM_STUCK: '晕死，结论还没写完就被一个会议打断了。你稍后重试就行。',
    PROMPT_QUERY_TIMEOUT: '配置文件查询超时，请稍后重试',
    PROMPT_TEMPLATE_LOAD_FAILED: '线上诊断模板加载失败',
    PROMPT_TOO_LONG: '简历与诊断规则总长度过长',
    VOLC_CONFIG_MISSING: '模型服务配置缺失',
    VOLC_KEY_MISSING: '模型服务密钥缺失',
    MODEL_EMPTY_BODY: '模型服务返回空响应',
    MODEL_EMPTY_RESPONSE: '模型没有返回有效内容',
    MODEL_RESPONSE_TOO_LARGE: '模型返回内容过长',
    MODEL_JSON_INVALID: '模型返回格式异常',
    MODEL_JSON_MISSING_FIELD: '模型返回缺少必填字段',
    COUNT_EXHAUST: '诊断次数已用尽，请购买或领取次数后再试',
    USER_NOT_FOUND: '用户不存在',
    TASK_CANCELLED: '诊断已取消',
    PERSIST_OR_CHARGE_FAILED: '结果保存或次数扣减失败'
  };
  const normalizedCode = code.startsWith('MODEL_HTTP_ERROR_') ? 'MODEL_HTTP_ERROR' : code;
  return {
    code: normalizedCode,
    message: messages[code] || (normalizedCode === 'MODEL_HTTP_ERROR' ? '模型服务请求失败' : '诊断服务临时异常')
  };
}

async function getTaskByDocumentId(documentId) {
  const result = await withTimeout(taskColl.doc(documentId).get(), 3000, 'DB_TASK_QUERY_TIMEOUT');
  const task = result.data?.[0];
  if (!task) return null;

  // CloudBase doc().get() does not consistently include `_id` in the returned
  // document. The task document ID is deliberately the same as task_id, so
  // restore it here for every ownership/update query used by the Worker.
  return { ...task, _id: task._id || documentId };
}

async function releaseUserTask(openid, taskId) {
  if (!openid) return;
  await withTimeout(
    db.collection('users')
      .where({ openid, active_diagnose_task_id: taskId })
      .update({ active_diagnose_task_id: null }),
    3000,
    'DB_USER_UPDATE_TIMEOUT'
  );
}

async function recoverExpiredTasks() {
  const now = Date.now();
  const result = await withTimeout(
    taskColl
      .where({ status: 'running', lease_expire_at: cmd.lt(now) })
      .limit(10)
      .get(),
    3000,
    'DB_TASK_QUERY_TIMEOUT'
  );

  for (const task of result.data || []) {
    const attemptCount = Number(task.attempt_count || 0);
    if (attemptCount >= MAX_ATTEMPTS) {
      const updateResult = await withTimeout(
        taskColl.where({ _id: task._id, status: 'running', lease_expire_at: cmd.lt(now) }).update({
          status: 'failed',
          stage: 'failed',
          error_code: 'WORKER_RETRY_EXHAUSTED',
          error_message: '后台任务重试次数已用尽',
          input: null,
          retryable: true,
          charged: false,
          worker_id: null,
          lease_expire_at: 0,
          finished_at: now,
          updated_at: now
        }),
        3000,
        'DB_TASK_UPDATE_TIMEOUT'
      );
      if (updateResult.updated > 0) await releaseUserTask(task.openid, task.task_id);
      continue;
    }

    await withTimeout(
      taskColl.where({ _id: task._id, status: 'running', lease_expire_at: cmd.lt(now) }).update({
        status: 'queued',
        stage: 'queued',
        worker_id: null,
        lease_expire_at: 0,
        heartbeat_at: 0,
        updated_at: now
      }),
      3000,
      'DB_TASK_UPDATE_TIMEOUT'
    );
  }
}

async function claimNextTask(workerId) {
  const queuedResult = await withTimeout(
    taskColl.where({ status: 'queued' }).orderBy('created_at', 'asc').limit(5).get(),
    3000,
    'DB_TASK_QUERY_TIMEOUT'
  );

  for (const candidate of queuedResult.data || []) {
    const now = Date.now();
    const updateResult = await withTimeout(
      taskColl.where({ _id: candidate._id, status: 'queued' }).update({
        status: 'running',
        stage: 'preparing',
        worker_id: workerId,
        lease_expire_at: now + LEASE_MS,
        heartbeat_at: now,
        started_at: candidate.started_at || now,
        attempt_count: cmd.inc(1),
        error_code: null,
        error_message: null,
        updated_at: now
      }),
      3000,
      'DB_TASK_UPDATE_TIMEOUT'
    );
    if (updateResult.updated > 0) return getTaskByDocumentId(candidate._id);
  }
  return null;
}

async function updateOwnedTask(task, workerId, update) {
  const result = await withTimeout(
    taskColl.where({ _id: task._id, status: 'running', worker_id: workerId }).update({
      ...update,
      updated_at: Date.now()
    }),
    3000,
    'DB_TASK_UPDATE_TIMEOUT'
  );
  if (result.updated === 0) {
    const error = new Error('TASK_LEASE_LOST');
    error.code = 'TASK_LEASE_LOST';
    throw error;
  }
}

async function finalizeSuccessfulTask(task, workerId, diagnosis) {
  // task_id is the canonical diagnose_task document ID. Do not depend on
  // CloudBase returning the synthetic `_id` field from doc().get().
  const taskDocumentId = task.task_id;
  const resultDocumentId = task.task_id;
  const now = Date.now();

  await db.runTransaction(async transaction => {
    const transactionTaskColl = transaction.collection('diagnose_task');
    const taskResult = await transactionTaskColl.doc(taskDocumentId).get();
    const currentTask = taskResult.data?.[0];
    if (!currentTask) throw new Error('TASK_NOT_FOUND');
    if (currentTask.status === 'succeeded' && currentTask.charged) return;
    if (currentTask.status !== 'running' || currentTask.worker_id !== workerId) {
      throw new Error('TASK_LEASE_LOST');
    }
    if (currentTask.cancel_requested) throw new Error('TASK_CANCELLED');

    const userResult = await transaction.collection('users').where({ openid: task.openid }).limit(1).get();
    const user = userResult.data?.[0];
    if (!user) throw new Error('USER_NOT_FOUND');

    const ledgerResult = await transaction.collection('diagnose_quota_ledger').doc(task.task_id).get();
    const existingLedger = ledgerResult.data?.[0];
    if (existingLedger?.charged) {
      if (user.active_diagnose_task_id === task.task_id) {
        await transaction.collection('users').doc(user._id).update({ active_diagnose_task_id: null });
      }
      await transactionTaskColl.doc(taskDocumentId).update({
        status: 'succeeded',
        stage: 'completed',
        charged: true,
        result_id: resultDocumentId,
        input: null,
        worker_id: null,
        lease_expire_at: 0,
        finished_at: now,
        updated_at: now
      });
      return;
    }

    let quotaType;
    if (Number(user.resumeFreeLeft || 0) > 0) quotaType = 'free';
    else if (Number(user.payResumeCount || 0) > 0) quotaType = 'paid';
    else throw new Error('COUNT_EXHAUST');

    const resultData = {
      task_id: task.task_id,
      openid: task.openid,
      resume_id: task.resume_id || null,
      diagnose_id: task.diagnose_id,
      overview: diagnosis.parsedResult.overview,
      advantages: diagnosis.parsedResult.advantages,
      improve: diagnosis.parsedResult.improve,
      optimize_ref: diagnosis.parsedResult.optimize_ref,
      final_tips: diagnosis.parsedResult.final_tips || null,
      create_time: db.serverDate(),
      time_to_first_token_sec: diagnosis.timeToFirstTokenSec,
      total_model_cost_sec: diagnosis.totalModelCostSec
    };

    await transaction.collection('diagnose_result').doc(resultDocumentId).set(resultData);
    await transaction.collection('users').doc(user._id).update({
      ...(quotaType === 'free'
        ? { resumeFreeLeft: cmd.inc(-1) }
        : { payResumeCount: cmd.inc(-1) }),
      active_diagnose_task_id: null
    });
    await transaction.collection('diagnose_quota_ledger').doc(task.task_id).set({
      task_id: task.task_id,
      openid: task.openid,
      status: 'charged',
      quota_type: quotaType,
      amount: 1,
      charged: true,
      created_at: currentTask.created_at,
      charged_at: now,
      updated_at: now
    });
    await transactionTaskColl.doc(taskDocumentId).update({
      status: 'succeeded',
      stage: 'completed',
        charged: true,
        result_id: resultDocumentId,
        input: null,
        worker_id: null,
      lease_expire_at: 0,
      finished_at: now,
      updated_at: now
    });
  });
}

async function failOwnedTask(task, workerId, error) {
  if (error?.code === 'TASK_LEASE_LOST' || error?.message === 'TASK_LEASE_LOST') return;
  const details = errorDetails(error);
  const now = Date.now();
  const cancelled = details.code === 'TASK_CANCELLED';
  const updateResult = await withTimeout(
    taskColl.where({ _id: task._id, status: 'running', worker_id: workerId }).update({
      status: cancelled ? 'cancelled' : 'failed',
      stage: cancelled ? 'cancelled' : 'failed',
      error_code: details.code,
      error_message: details.message,
      input: null,
      retryable: !cancelled && details.code !== 'COUNT_EXHAUST',
      charged: false,
      worker_id: null,
      lease_expire_at: 0,
      finished_at: now,
      updated_at: now
    }),
    3000,
    'DB_TASK_UPDATE_TIMEOUT'
  );
  if (updateResult.updated > 0) await releaseUserTask(task.openid, task.task_id);
}

async function processTask(task, workerId) {
  const taskAbortCtrl = new AbortController();
  let taskAbortReason = null;
  let pendingText = '';
  let nextSeq = Number(task.preview_seq || 0) + 1;
  let leaseRenewing = false;
  let flushChain = Promise.resolve();

  // 租约过期后的重试会重新调用模型。清除上一次的半截预览，并通过attempt_count
  // 告知前端这是新一轮生成，避免两轮内容拼接在一起。
  if (Number(task.attempt_count || 0) > 1) {
    await withTimeout(
      chunkColl.where({ task_id: task.task_id }).remove(),
      3000,
      'DB_CHUNK_DELETE_TIMEOUT'
    );
    await updateOwnedTask(task, workerId, {
      preview_seq: 0,
      has_first_token: false,
      first_token_at: 0,
      stage: 'preparing'
    });
    task.preview_seq = 0;
    nextSeq = 1;
  }

  const flushPendingText = async () => {
    if (!pendingText) return;
    const text = pendingText;
    pendingText = '';
    const seq = nextSeq++;
    const now = Date.now();
    await withTimeout(
      chunkColl.doc(chunkDocumentId(task.task_id, seq)).set({
        task_id: task.task_id,
        seq,
        text,
        char_count: text.length,
        create_time: now
      }),
      3000,
      'DB_CHUNK_INSERT_TIMEOUT'
    );
    await updateOwnedTask(task, workerId, { preview_seq: seq, stage: 'generating' });
  };

  const scheduleFlush = () => {
    flushChain = flushChain.then(flushPendingText);
    flushChain.catch(error => {
      taskAbortReason = error.code || error.message || 'DB_CHUNK_INSERT_TIMEOUT';
      if (!taskAbortCtrl.signal.aborted) taskAbortCtrl.abort();
    });
    return flushChain;
  };

  const chunkFlushTimer = setInterval(() => {
    if (pendingText) scheduleFlush();
  }, CHUNK_FLUSH_MS);

  const leaseTimer = setInterval(async () => {
    if (leaseRenewing || taskAbortCtrl.signal.aborted) return;
    leaseRenewing = true;
    try {
      const now = Date.now();
      const updateResult = await withTimeout(
        taskColl.where({
          _id: task._id,
          status: 'running',
          worker_id: workerId,
          cancel_requested: false
        }).update({
          lease_expire_at: now + LEASE_MS,
          heartbeat_at: now,
          updated_at: now
        }),
        3000,
        'DB_TASK_LEASE_TIMEOUT'
      );
      if (updateResult.updated === 0) {
        const latestTask = await getTaskByDocumentId(task._id);
        taskAbortReason = latestTask?.cancel_requested ? 'TASK_CANCELLED' : 'TASK_LEASE_LOST';
        taskAbortCtrl.abort();
      }
    } catch (error) {
      taskAbortReason = 'TASK_LEASE_LOST';
      taskAbortCtrl.abort();
    } finally {
      leaseRenewing = false;
    }
  }, LEASE_RENEW_MS);

  try {
    const diagnosis = await runResumeDiagnosis(task.input, {
      onModelStart: async ({ modelStartedAt }) => {
        await updateOwnedTask(task, workerId, {
          stage: 'waiting_first_token',
          model_started_at: modelStartedAt
        });
      },
      onWaiting: async () => {
        await withTimeout(
          taskColl.where({
            _id: task._id,
            status: 'running',
            worker_id: workerId,
            has_first_token: false
          }).update({
            stage: 'first_token_waiting',
            notice_code: 'FIRST_TOKEN_WAITING',
            notice_message: '稍等片刻，一些局部还在精心梳理中',
            updated_at: Date.now()
          }),
          3000,
          'DB_TASK_UPDATE_TIMEOUT'
        );
      },
      onFirstToken: async ({ firstTokenAt }) => {
        await updateOwnedTask(task, workerId, {
          stage: 'generating',
          has_first_token: true,
          first_token_at: firstTokenAt,
          notice_code: null,
          notice_message: null
        });
      },
      onChunk: text => {
        pendingText += text;
        if (pendingText.length >= CHUNK_FLUSH_CHAR_COUNT) scheduleFlush();
      },
      onComplete: async () => {
        await scheduleFlush();
        await updateOwnedTask(task, workerId, { stage: 'validating' });
      }
    }, {
      signal: taskAbortCtrl.signal,
      getAbortReason: () => taskAbortReason
    });

    await scheduleFlush();
    await flushChain;
    // 模型和分片均已完成，先续足一次租约，再停止周期续租并执行短事务。
    await updateOwnedTask(task, workerId, {
      stage: 'charging',
      lease_expire_at: Date.now() + LEASE_MS,
      heartbeat_at: Date.now()
    });
    clearInterval(leaseTimer);
    try {
      await finalizeSuccessfulTask(task, workerId, diagnosis);
    } catch (error) {
      const latestTask = await getTaskByDocumentId(task._id).catch(() => null);
      if (latestTask?.status === 'succeeded' && latestTask?.charged) return;
      const preservedErrors = ['COUNT_EXHAUST', 'TASK_CANCELLED', 'TASK_LEASE_LOST'];
      const wrapped = new Error(preservedErrors.includes(error.message) ? error.message : 'PERSIST_OR_CHARGE_FAILED');
      wrapped.code = wrapped.message;
      wrapped.cause = error;
      throw wrapped;
    }
  } catch (error) {
    if (taskAbortReason && !error.code) error.code = taskAbortReason;
    await failOwnedTask(task, workerId, error);
    console.error(`【诊断Worker失败】taskId=${task.task_id}`, error);
  } finally {
    clearInterval(chunkFlushTimer);
    clearInterval(leaseTimer);
  }
}

async function runWorkerLoop(workerId) {
  console.log(`【诊断Worker启动】workerId=${workerId}`);
  let lastRecoveryAt = 0;

  while (!workerStopping) {
    try {
      if (Date.now() - lastRecoveryAt > LEASE_MS) {
        await recoverExpiredTasks();
        lastRecoveryAt = Date.now();
      }
      const task = await claimNextTask(workerId);
      if (!task) {
        await sleep(POLL_IDLE_MS);
        continue;
      }
      await processTask(task, workerId);
      await sleep(POLL_ACTIVE_MS);
    } catch (error) {
      console.error('【诊断Worker循环异常】', error);
      await sleep(POLL_IDLE_MS);
    }
  }
}

function startDiagnoseWorker() {
  if (workerStarted) return workerLoopPromise;
  workerStarted = true;
  workerStopping = false;
  const workerId = createWorkerId();
  workerLoopPromise = runWorkerLoop(workerId).catch(error => {
    console.error('【诊断Worker意外退出】', error);
    workerStarted = false;
  });
  return workerLoopPromise;
}

function stopDiagnoseWorker() {
  workerStopping = true;
}

module.exports = {
  startDiagnoseWorker,
  stopDiagnoseWorker
};
