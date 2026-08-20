'use strict';

const crypto = require('crypto');
const express = require('express');
const { db } = require('./diagnose-db');

const router = express.Router();
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const SEARCH_SCAN_LIMIT = 2000;
const ALLOWED_STATUSES = new Set(['pending', 'processed', 'all']);

function configuredToken() {
  return String(process.env.CONSULT_ADMIN_TOKEN || '').trim();
}

function tokensMatch(actual, expected) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function requireSharedLink(req, res, next) {
  const expected = configuredToken();
  if (expected.length < 32) {
    return res.status(503).json({ code: -1, msg: '客服工作台访问密钥未配置' });
  }

  const authorization = String(req.get('authorization') || '');
  const actual = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!tokensMatch(actual, expected)) {
    return res.status(401).json({ code: -1, msg: '访问链接无效或已过期' });
  }
  return next();
}

function publicConsult(item) {
  return {
    _id: item._id,
    _openid: item._openid || '',
    consultType: item.consultType || '',
    content: item.content || '',
    createTime: item.createTime || '',
    nickName: item.nickName || '',
    status: item.status || 'pending',
    remark: item.remark || '',
    processedAt: item.processedAt || ''
  };
}

function includesSearch(item, search) {
  if (!search) return true;
  return [item._openid, item.consultType, item.content, item.nickName, item.remark]
    .some(value => String(value || '').toLowerCase().includes(search));
}

async function searchConsults(status, search) {
  const matches = [];
  for (let skip = 0; skip < SEARCH_SCAN_LIMIT; skip += MAX_PAGE_SIZE) {
    let query = db.collection('user_consult');
    if (status !== 'all') query = query.where({ status });
    const result = await query.orderBy('createTime', 'desc').skip(skip).limit(MAX_PAGE_SIZE).get();
    matches.push(...result.data.filter(item => includesSearch(item, search)));
    if (result.data.length < MAX_PAGE_SIZE) break;
  }
  return matches;
}

router.use(requireSharedLink);

router.get('/list', async (req, res) => {
  try {
    const page = Math.max(0, Number.parseInt(req.query.page, 10) || 0);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(req.query.pageSize, 10) || DEFAULT_PAGE_SIZE));
    const requestedStatus = String(req.query.status || 'pending');
    const status = ALLOWED_STATUSES.has(requestedStatus) ? requestedStatus : 'pending';
    const search = String(req.query.search || '').trim().toLowerCase().slice(0, 100);
    let list;
    let hasMore;

    if (search) {
      const matches = await searchConsults(status, search);
      list = matches.slice(page * pageSize, (page + 1) * pageSize);
      hasMore = matches.length > (page + 1) * pageSize;
    } else {
      let query = db.collection('user_consult');
      if (status !== 'all') query = query.where({ status });
      const result = await query.orderBy('createTime', 'desc').skip(page * pageSize).limit(pageSize).get();
      list = result.data;
      hasMore = list.length === pageSize;
    }

    return res.json({ code: 0, data: { list: list.map(publicConsult), page, pageSize, hasMore } });
  } catch (error) {
    console.error('【客服工作台查询异常】', error);
    return res.status(500).json({ code: -1, msg: '咨询记录查询失败' });
  }
});

router.post('/:consultId/process', async (req, res) => {
  try {
    const consultId = String(req.params.consultId || '').trim();
    const remark = String(req.body.remark || '').trim().slice(0, 500);
    if (!consultId || consultId.length > 128) {
      return res.status(400).json({ code: -1, msg: '咨询记录编号无效' });
    }

    const processedAt = new Date().toISOString();
    await db.collection('user_consult').doc(consultId).update({
      status: 'processed',
      remark,
      processedAt,
      processedBy: 'consult-admin-shared-link'
    });
    return res.json({ code: 0, data: { consultId, status: 'processed', remark, processedAt } });
  } catch (error) {
    console.error('【客服工作台更新异常】', error);
    return res.status(500).json({ code: -1, msg: '咨询记录更新失败' });
  }
});

module.exports = router;
