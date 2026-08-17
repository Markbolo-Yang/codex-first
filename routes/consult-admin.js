'use strict';

const express = require('express');
const axios = require('axios');
const { db } = require('./diagnose-db');

const router = express.Router();
const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const ALLOWED_STATUSES = new Set(['pending', 'processed']);

function configuredAdmins() {
  return new Set(
    String(process.env.CONSULT_ADMIN_OPENIDS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  );
}

async function authenticate(code) {
  if (!code) {
    const error = new Error('缺少微信登录凭证');
    error.statusCode = 401;
    throw error;
  }

  const admins = configuredAdmins();
  if (admins.size === 0) {
    const error = new Error('客服管理员名单未配置');
    error.statusCode = 503;
    throw error;
  }

  const { data } = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
    params: {
      appid: process.env.APPID,
      secret: process.env.APPSECRET,
      js_code: code,
      grant_type: 'authorization_code'
    },
    timeout: 5000
  });

  if (!data.openid || !admins.has(data.openid)) {
    const error = new Error('无权访问客服工作台');
    error.statusCode = 403;
    throw error;
  }

  return data.openid;
}

function sendError(res, error) {
  const statusCode = error.statusCode || 500;
  if (statusCode === 500) console.error('【客服工作台异常】', error);
  return res.status(statusCode).json({ code: -1, msg: error.message || '服务异常' });
}

router.post('/list', async (req, res) => {
  try {
    await authenticate(req.body.code);
    const page = Math.max(0, Number.parseInt(req.body.page, 10) || 0);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(req.body.pageSize, 10) || PAGE_SIZE));
    const status = String(req.body.status || 'pending');

    let query = db.collection('user_consult');
    if (ALLOWED_STATUSES.has(status)) query = query.where({ status });

    const result = await query
      .orderBy('createTime', 'desc')
      .skip(page * pageSize)
      .limit(pageSize)
      .get();

    return res.json({
      code: 0,
      data: {
        list: result.data,
        page,
        pageSize,
        hasMore: result.data.length === pageSize
      }
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/:consultId/process', async (req, res) => {
  try {
    const adminOpenId = await authenticate(req.body.code);
    const consultId = String(req.params.consultId || '').trim();
    const remark = String(req.body.remark || '').trim().slice(0, 500);
    if (!consultId || consultId.length > 128) {
      return res.status(400).json({ code: -1, msg: '咨询记录编号无效' });
    }

    await db.collection('user_consult').doc(consultId).update({
      status: 'processed',
      remark,
      processedAt: new Date().toISOString(),
      processedBy: adminOpenId
    });

    return res.json({ code: 0, data: { consultId, status: 'processed', remark } });
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
