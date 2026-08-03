'use strict';

const express = require('express');
const axios = require('axios');
const { db } = require('./routes/diagnose-db');
const { startDiagnoseWorker, stopDiagnoseWorker } = require('./routes/diagnose-worker');

const app = express();
app.use(express.json());

const APPID = process.env.APPID;
const APPSECRET = process.env.APPSECRET;
// 诊断路由、Worker与app共用diagnose-db中的同一个CloudBase实例。
app.db = db;

// 现有支付、配额和诊断路由保持由routes/index统一挂载。
const indexRouter = require('./routes/index');
app.use('/api', indexRouter);

app.get('/api/getOpenId', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.json({ code: -1, msg: '缺少code' });
  try {
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${APPID}&secret=${APPSECRET}&js_code=${code}&grant_type=authorization_code`;
    const { data } = await axios.get(url);
    if (!data.openid) return res.json({ code: -2, msg: 'code无效' });
    return res.json({ code: 0, openId: data.openid });
  } catch (error) {
    console.error('【获取OpenID失败】', error);
    return res.json({ code: -99, msg: '服务异常' });
  }
});

app.get('/api/getUserData', async (req, res) => {
  try {
    const { code, openId, type } = req.query;
    if (!code || !openId || !type) return res.json({ code: -1, msg: '参数不全' });
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${APPID}&secret=${APPSECRET}&js_code=${code}&grant_type=authorization_code`;
    const { data } = await axios.get(url);
    const realOpen = data.openid;
    if (realOpen !== openId) return res.json({ code: -2, msg: '身份不符禁止访问' });

    let coll;
    switch (type) {
      case 'order': coll = 'user_order'; break;
      case 'member': coll = 'user_vip'; break;
      case 'resume': coll = 'resume_record'; break;
      default: return res.json({ code: -3, msg: '类型错误' });
    }
    const list = await db.collection(coll).where({ openId: realOpen }).get();
    return res.json({ code: 0, data: list.data });
  } catch (error) {
    console.error('【获取用户数据失败】', error);
    return res.json({ code: -99, msg: '服务异常' });
  }
});

app.get('/api/debugEnv', (req, res) => {
  res.json({
    TCB_ENV: process.env.TCB_ENV ?? '未配置',
    APPID: process.env.APPID ?? '未配置',
    APPSECRET: process.env.APPSECRET ? '已配置' : '未配置',
    TCB_SECRET_ID: process.env.TCB_SECRET_ID ? '已配置' : '未配置',
    TCB_SECRET_KEY: process.env.TCB_SECRET_KEY ? '已配置' : '未配置'
  });
});

const PORT = Number(process.env.PORT || 3000);
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Express server listening on port ${PORT}`);
  // 每个Node进程只启动一次。数据库租约负责多实例之间的任务抢占。
  startDiagnoseWorker();
});

function shutdown(signal) {
  console.log(`【服务退出】收到${signal}，停止领取新的诊断任务`);
  stopDiagnoseWorker();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
