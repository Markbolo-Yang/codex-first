'use strict';

const crypto = require('crypto');
const express = require('express');
const { db, cmd, withTimeout } = require('./diagnose-db');

const router = express.Router();
const taskColl = db.collection('interview_task');
const chunkColl = db.collection('interview_task_chunk');
const resultColl = db.collection('interview_result');

function firstDocument(result) {
  return Array.isArray(result?.data) ? (result.data[0] || null) : (result?.data || null);
}

function createTaskId() {
  // 控制在32字符以内，可直接作为CloudBase文档ID用于任务、结果和扣费流水幂等。
  return `int_${Date.now().toString(36)}_${crypto.randomBytes(8).toString('hex')}`;
}

function createInterviewId() {
  return Number(`${Date.now()}${crypto.randomInt(0, 1000).toString().padStart(3, '0')}`);
}

function safeInputValue(value) {
  if (typeof value === 'string') return value;
  return value || {};
}

function validateCreateBody(body) {
  const { openid, hasResume, resumeInfo, jobIntention, resume_id } = body || {};
  if (!openid || !jobIntention || (hasResume && !resumeInfo)) {
    const error = new Error('PARAM_ERROR');
    error.httpStatus = 400;
    throw error;
  }
  return {
    openid,
    resume_id: resume_id || null,
    input: {
      hasResume: Boolean(hasResume),
      resumeInfo: hasResume ? safeInputValue(resumeInfo) : '',
      jobIntention: safeInputValue(jobIntention)
    }
  };
}

async function createOrGetTask(body) {
  const request = validateCreateBody(body);
  const now = Date.now();

  return db.runTransaction(async transaction => {
    const usersColl = transaction.collection('users');
    const userResult = await usersColl.where({ openid: request.openid }).limit(1).get();
    const user = firstDocument(userResult);
    if (!user) throw new Error('USER_NOT_FOUND');

    const totalQuota = Number(user.interviewFreeLeft || 0) + Number(user.payInterviewCount || 0);
    if (totalQuota <= 0) throw new Error('COUNT_EXHAUST');

    if (user.active_interview_task_id) {
      const activeResult = await transaction.collection('interview_task')
        .doc(user.active_interview_task_id)
        .get();
      const activeTask = firstDocument(activeResult);
      if (activeTask && ['queued', 'running'].includes(activeTask.status)) {
        return { task: activeTask, reused: true };
      }
    }

    const taskId = createTaskId();
    const task = {
      task_id: taskId,
      interview_id: createInterviewId(),
      openid: request.openid,
      resume_id: request.resume_id,
      status: 'queued',
      stage: 'queued',
      input: request.input,
      has_first_token: false,
      preview_seq: 0,
      result_id: null,
      error_code: null,
      error_message: null,
      notice_code: null,
      notice_message: null,
      charged: false,
      retryable: true,
      cancel_requested: false,
      worker_id: null,
      lease_expire_at: 0,
      heartbeat_at: 0,
      attempt_count: 0,
      created_at: now,
      started_at: 0,
      model_started_at: 0,
      first_token_at: 0,
      finished_at: 0,
      updated_at: now
    };

    await transaction.collection('interview_task').doc(taskId).set(task);
    await usersColl.doc(user._id).update({ active_interview_task_id: taskId });
    return { task: { ...task, _id: taskId }, reused: false };
  });
}

async function getOwnedTask(taskId, openid) {
  if (!taskId || !openid) return null;
  const result = await withTimeout(
    taskColl.where({ task_id: taskId }).limit(1).get(),
    3000,
    'DB_TASK_QUERY_TIMEOUT'
  );
  const task = firstDocument(result);
  return task?.openid === openid ? task : null;
}

async function getTaskChunks(taskId, afterSeq, limit = 20) {
  const safeAfterSeq = Math.max(0, Number(afterSeq) || 0);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const result = await withTimeout(
    chunkColl
      .where({ task_id: taskId, seq: cmd.gt(safeAfterSeq) })
      .orderBy('seq', 'asc')
      .limit(safeLimit)
      .get(),
    3000,
    'DB_CHUNK_QUERY_TIMEOUT'
  );
  return result.data || [];
}

async function getTaskResult(task) {
  if (task.status !== 'succeeded' || !task.result_id) return null;
  const result = await withTimeout(
    resultColl.where({ task_id: task.task_id }).limit(1).get(),
    3000,
    'DB_RESULT_QUERY_TIMEOUT'
  );
  const document = firstDocument(result);
  if (!document) return null;
  return {
    interview_id: document.interview_id,
    resume_id: document.resume_id,
    status: document.status,
    brief_summary: document.brief_summary,
    profileOverview: document.profileOverview,
    keyExaminePoint: document.keyExaminePoint,
    matchAdvice: document.matchAdvice,
    interviewSkillGuide: document.interviewSkillGuide,
    questionList: document.questionList
  };
}

function publicTask(task) {
  return {
    task_id: task.task_id,
    status: task.status,
    stage: task.stage,
    has_first_token: Boolean(task.has_first_token),
    latest_seq: Number(task.preview_seq || 0),
    notice_code: task.notice_code || null,
    notice_message: task.notice_message || null,
    error_code: task.error_code || null,
    error_message: task.error_message || null,
    charged: Boolean(task.charged),
    noDeduct: !task.charged,
    retryable: task.retryable !== false,
    cancel_requested: Boolean(task.cancel_requested),
    generation: Number(task.attempt_count || 0),
    created_at: task.created_at || 0,
    model_started_at: task.model_started_at || 0,
    first_token_at: task.first_token_at || 0,
    finished_at: task.finished_at || 0
  };
}

function createErrorResponse(error) {
  const code = error?.message || 'TASK_CREATE_FAILED';
  if (code === 'PARAM_ERROR') return { status: 400, body: { code, msg: '缺少openid、面试意向或简历参数' } };
  if (code === 'USER_NOT_FOUND') return { status: 404, body: { code, msg: '用户不存在', noDeduct: true } };
  if (code === 'COUNT_EXHAUST') {
    return { status: 409, body: { code, msg: '面试建议次数已用尽，请购买或领取次数后再试', noDeduct: true, retryable: false } };
  }
  return { status: 500, body: { code: 'TASK_CREATE_FAILED', msg: '面试建议任务创建失败，本次未扣次数', noDeduct: true } };
}

// 小程序正式入口：快速登记任务并返回taskId，不在本次HTTP请求内运行模型。
router.post('/tasks', async (req, res) => {
  try {
    const { task, reused } = await createOrGetTask(req.body);
    res.status(reused ? 200 : 202).json({
      code: 0,
      reused,
      data: publicTask(task)
    });
  } catch (error) {
    console.error('【面试建议任务创建失败】', error);
    const response = createErrorResponse(error);
    res.status(response.status).json(response.body);
  }
});

// 小程序轮询入口：after_seq之后只返回新增批次，成功时附带权威结构化结果。
router.get('/tasks/:taskId', async (req, res) => {
  try {
    const task = await getOwnedTask(req.params.taskId, req.query.openid);
    if (!task) return res.status(404).json({ code: 'TASK_NOT_FOUND', msg: '面试建议任务不存在' });

    const requestedAfterSeq = Math.max(0, Number(req.query.after_seq) || 0);
    // Worker重试会清空旧预览并将preview_seq从0重新计数；自动让旧游标回到0。
    const effectiveAfterSeq = requestedAfterSeq > Number(task.preview_seq || 0) ? 0 : requestedAfterSeq;
    const chunks = await getTaskChunks(task.task_id, effectiveAfterSeq, req.query.limit);
    const result = await getTaskResult(task);
    const latestReturnedSeq = chunks.length > 0
      ? Number(chunks[chunks.length - 1].seq)
      : effectiveAfterSeq;

    return res.json({
      code: 0,
      data: {
        ...publicTask(task),
        chunks: chunks.map(chunk => ({ seq: chunk.seq, text: chunk.text })),
        latest_returned_seq: latestReturnedSeq,
        has_more: latestReturnedSeq < Number(task.preview_seq || 0),
        result
      }
    });
  } catch (error) {
    console.error('【面试建议任务查询失败】', error);
    return res.status(500).json({ code: 'TASK_QUERY_FAILED', msg: '面试建议进度查询失败，请稍后重试' });
  }
});

// 用户明确取消才终止后台任务；页面退出、网络中断不会自动取消。
router.post('/tasks/:taskId/cancel', async (req, res) => {
  try {
    const task = await getOwnedTask(req.params.taskId, req.body?.openid);
    if (!task) return res.status(404).json({ code: 'TASK_NOT_FOUND', msg: '面试建议任务不存在' });
    if (['succeeded', 'failed', 'cancelled'].includes(task.status)) {
      return res.json({ code: 0, data: publicTask(task) });
    }

    const now = Date.now();
    if (task.status === 'queued') {
      await db.runTransaction(async transaction => {
        const taskResult = await transaction.collection('interview_task').doc(task._id).get();
        const currentTask = firstDocument(taskResult);
        if (!currentTask || currentTask.status !== 'queued') return;
        await transaction.collection('interview_task').doc(task._id).update({
          status: 'cancelled',
          stage: 'cancelled',
          cancel_requested: true,
          error_code: 'TASK_CANCELLED',
          error_message: '诊断已取消',
          input: null,
          retryable: true,
          charged: false,
          finished_at: now,
          updated_at: now
        });
        const userResult = await transaction.collection('users').where({ openid: task.openid }).limit(1).get();
        const user = firstDocument(userResult);
        if (user?.active_interview_task_id === task.task_id) {
          await transaction.collection('users').doc(user._id).update({ active_interview_task_id: null });
        }
      });
    } else {
      await withTimeout(
        taskColl.where({ _id: task._id, status: 'running' }).update({
          cancel_requested: true,
          updated_at: now
        }),
        3000,
        'DB_TASK_UPDATE_TIMEOUT'
      );
    }

    const updatedTask = await getOwnedTask(task.task_id, task.openid);
    return res.json({ code: 0, data: publicTask(updatedTask || task) });
  } catch (error) {
    console.error('【取消面试建议任务失败】', error);
    return res.status(500).json({ code: 'TASK_CANCEL_FAILED', msg: '取消面试建议失败，请稍后重试' });
  }
});

// 保留原curl地址作为内部兼容入口，但实际执行已解耦为后台任务。
// 客户端断开只停止本次转发，不会取消Worker中的模型生成。
router.post('/run', async (req, res) => {
  let heartbeatTimer = null;
  let relayTimer = null;
  let clientClosed = false;

  try {
    const { task } = await createOrGetTask(req.body);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let lastSeq = 0;
    let lastStage = null;
    const closeHandler = () => { clientClosed = true; };
    req.socket.once('close', closeHandler);

    heartbeatTimer = setInterval(() => {
      if (!clientClosed && !res.writableEnded) res.write(':heartbeat\n\n');
    }, 5000);

    await new Promise(resolve => {
      let polling = false;
      relayTimer = setInterval(async () => {
        if (polling) return;
        if (clientClosed || res.writableEnded) {
          clearInterval(relayTimer);
          req.socket.off('close', closeHandler);
          resolve();
          return;
        }
        polling = true;
        try {
          const latestTask = await getOwnedTask(task.task_id, task.openid);
          if (!latestTask) throw new Error('TASK_NOT_FOUND');
          const chunks = await getTaskChunks(task.task_id, lastSeq, 50);
          for (const chunk of chunks) {
            res.write(`data: ${JSON.stringify({ chunk: chunk.text, seq: chunk.seq })}\n\n`);
            lastSeq = Number(chunk.seq);
          }
          if (latestTask.stage !== lastStage) {
            lastStage = latestTask.stage;
            if (latestTask.notice_code) {
              res.write(`data: ${JSON.stringify({
                type: 'status',
                code: latestTask.notice_code,
                msg: latestTask.notice_message
              })}\n\n`);
            }
          }
          if (latestTask.status === 'succeeded') {
            res.write(`data: ${JSON.stringify({ finish: true, task_id: task.task_id })}\n\n`);
            res.end();
            clearInterval(relayTimer);
            req.socket.off('close', closeHandler);
            resolve();
          } else if (['failed', 'cancelled'].includes(latestTask.status)) {
            res.write(`data: ${JSON.stringify({
              code: latestTask.error_code,
              msg: latestTask.error_message,
              noDeduct: true
            })}\n\n`);
            res.end();
            clearInterval(relayTimer);
            req.socket.off('close', closeHandler);
            resolve();
          }
        } catch (error) {
          console.error('【兼容SSE转发失败】', error);
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ code: 'TASK_QUERY_FAILED', msg: '面试建议进度查询失败', noDeduct: true })}\n\n`);
            res.end();
          }
          clearInterval(relayTimer);
          req.socket.off('close', closeHandler);
          resolve();
        } finally {
          polling = false;
        }
      }, 800);
    });
  } catch (error) {
    const response = createErrorResponse(error);
    if (!res.headersSent) res.status(response.status).json(response.body);
    else if (!res.writableEnded) res.end();
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (relayTimer) clearInterval(relayTimer);
  }
});

module.exports = router;
