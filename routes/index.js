
var express = require('express');

var router = express.Router();
// ==========新增：路由引入，紧跟router初始化==========
const diagnoseRouter = require('./diagnose');
const resumeParserRouter = require('./resume-parser');
const interviewRouter = require('./interview');
// 云数据库全局初始化
const cloudbase = require('@cloudbase/node-sdk');

const tcbSdk = cloudbase.init({
  secretId: process.env.TCB_SECRET_ID,
  secretKey: process.env.TCB_SECRET_KEY,
  env: process.env.TCB_ENV,
  region: 'ap-shanghai'
});

const db = tcbSdk.database();
const cmd = db.command;
// 证书路径依赖
const fs = require('fs');

const path = require('path');

const crypto = require('crypto');

const https = require('https');

const { URL } = require('url');
// =========== 证书全局常量 ===========
const PRIVATE_KEY_PATH = path.join(__dirname, '../apiclient_key.pem');

const CERT_PATH = path.join(__dirname, '../apiclient_cert.pem');
// ✅ 微信支付公钥（阶段 2B 新增）
const WECHAT_PUB_KEY_PATH = path.join(__dirname, '../pub_key.pem');

const WECHAT_PUB_ID = process.env.WECHAT_PUB_ID;
// ✅ 加载商户私钥
let PRIVATE_KEY_RAW = '';

if (fs.existsSync(PRIVATE_KEY_PATH)) {
  PRIVATE_KEY_RAW = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8').replace(/\r/g, '');

  console.log('【容器证书校验】私钥加载成功');

} else {
  console.error('【致命错误】未找到商户私钥');

}
// ✅ 加载微信支付公钥（阶段 2B）
let WECHAT_PUB_KEY_RAW = '';

if (fs.existsSync(WECHAT_PUB_KEY_PATH)) {
  WECHAT_PUB_KEY_RAW = fs.readFileSync(WECHAT_PUB_KEY_PATH, 'utf8').replace(/\r/g, '');

  console.log('【V3回调验签】微信支付公钥加载成功，公钥ID：', WECHAT_PUB_ID);

} else {
  console.error('【致命错误】未找到微信支付公钥 pub_key.pem');

}
// 启动校验日志
console.log('===== 证书文件校验 =====');

console.log('私钥存在：', fs.existsSync(PRIVATE_KEY_PATH));

console.log('商户证书存在：', fs.existsSync(CERT_PATH));

console.log('微信公钥存在：', fs.existsSync(WECHAT_PUB_KEY_PATH));

console.log('微信公钥ID：', WECHAT_PUB_ID);

console.log('=========================');
// 修复：增加定时器清理，杜绝内存泄漏
function withTimeout(promise, ms = 3000, errMsg = '数据库连接超时') {
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(errMsg)), ms);

  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));

}
// ========== 用户初始化（事务加固，防止并发创建重复用户） ==========
async function initUser(openid) {
  return db.runTransaction(async transaction => {
    const userColl = transaction.collection('users');

    const now = Date.now();

    const nowStr = new Date().toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).replace(/\//g, '-');

    const userRes = await withTimeout(userColl.where({ openid }).get());

    if (userRes.data.length === 0) {
      console.log('【用户初始化】新用户创建，openid：', openid);

      await withTimeout(userColl.add({
        openid,
        resumeFreeLeft: 2,
        interviewFreeLeft: 2,
        payResumeCount: 0,
        payInterviewCount: 0,
        createTimeStr: nowStr,
        createdAt: now,
        lastLoginAt: now,
        lastLoginStr: nowStr
      }));

      const newUser = await withTimeout(userColl.where({ openid }).get());

      return newUser.data[0];

    }

    await withTimeout(userColl.doc(userRes.data[0]._id).update({
      lastLoginAt: now,
      lastLoginStr: nowStr
    }));

    return userRes.data[0];

  });

}
// 简历诊断路由挂载，鉴权逻辑放在diagnose内部，规避SSE中间件冲突
router.use('/diagnose', diagnoseRouter);
// 简历文件解析路由挂载；支付、配额和扣次逻辑保持不变
router.use('/resume', resumeParserRouter);
router.use('/interview', interviewRouter);

router.get('/', (req, res) => res.render('index', { title: 'Express' }));
// ========== 用户配额 ==========
router.post('/getUserQuota', async (req, res) => {
  try {
    const { openId } = req.body;

    if (!openId) return res.json({ code: -1, msg: '缺少openId参数' });

    await initUser(openId);

    const userData = await withTimeout(db.collection('users').where({ openid: openId }).get());

    if (userData.data.length === 0) return res.json({ code: -2, msg: '用户不存在' });

    const info = userData.data[0];

    console.log('【配额查询】用户', openId, '简历免费剩余：', info.resumeFreeLeft, '面试免费剩余：', info.interviewFreeLeft, '简历付费次数：', info.payResumeCount, '面试付费次数：', info.payInterviewCount);

    return res.json({
      code: 0,
      data: {
        resumeFreeLeft: info.resumeFreeLeft ?? 2,
        interviewFreeLeft: info.interviewFreeLeft ?? 2,
        payResumeCount: info.payResumeCount || 0,
        payInterviewCount: info.payInterviewCount || 0
      }

    });

  } catch (err) {
    console.error('【配额查询异常】', err);

    return res.json({ code: -99, msg: String(err) });

  }

});
// ========== 扣减配额 ==========
router.post('/deductQuota', async (req, res) => {
  try {
    const { openId, type } = req.body;

    if (!openId || !type) return res.json({ code: -1, msg: '参数缺失' });

    await initUser(openId);

    const userData = await withTimeout(db.collection('users').where({ openid: openId }).get());

    if (userData.data.length === 0) return res.json({ code: -2, msg: '用户不存在' });

    const info = userData.data[0];

    const updateObj = {};

    if (type === 'resume') {
      if (info.resumeFreeLeft > 0) {
        updateObj.resumeFreeLeft = info.resumeFreeLeft - 1;

        console.log('【扣减次数】简历免费次数消耗1，剩余：', updateObj.resumeFreeLeft);

      } else if (info.payResumeCount > 0) {
        updateObj.payResumeCount = info.payResumeCount - 1;

        console.log('【扣减次数】简历付费次数消耗1，剩余：', updateObj.payResumeCount);

      } else return res.json({ code: -3, msg: '简历次数耗尽' });

    } else if (type === 'interview') {
      if (info.interviewFreeLeft > 0) {
        updateObj.interviewFreeLeft = info.interviewFreeLeft - 1;

        console.log('【扣减次数】面试免费次数消耗1，剩余：', updateObj.interviewFreeLeft);

      } else if (info.payInterviewCount > 0) {
        updateObj.payInterviewCount = info.payInterviewCount - 1;

        console.log('【扣减次数】面试付费次数消耗1，剩余：', updateObj.payInterviewCount);

      } else return res.json({ code: -3, msg: '面试次数耗尽' });

    } else return res.json({ code: -4, msg: 'type非法' });

    await withTimeout(db.collection('users').doc(info._id).update(updateObj));

    return res.json({ code: 0, msg: '扣减成功' });

  } catch (err) {
    console.error('【扣减配额异常】', err);

    return res.json({ code: -99, msg: String(err) });

  }

});
// ========== 增加付费次数 ==========
router.post('/addPayCount', async (req, res) => {
  try {
    const { openId, type } = req.body;

    if (!openId || !type) return res.json({ code: -1, msg: '参数缺失' });

    await initUser(openId);

    const userData = await withTimeout(db.collection('users').where({ openid: openId }).get());

    if (userData.data.length === 0) return res.json({ code: -2, msg: '用户不存在' });

    const info = userData.data[0];

    const updateObj = {};

    if (type === 'resume') {
      updateObj.payResumeCount = (info.payResumeCount || 0) + 1;

      console.log('【手动发放付费次数】简历付费次数+1，新值：', updateObj.payResumeCount);

    } else if (type === 'interview') {
      updateObj.payInterviewCount = (info.payInterviewCount || 0) + 1;

      console.log('【手动发放付费次数】面试付费次数+1，新值：', updateObj.payInterviewCount);

    } else return res.json({ code: -3, msg: '类型错误' });

    await withTimeout(db.collection('users').doc(info._id).update(updateObj));

    return res.json({ code: 0, msg: '付费次数发放成功' });

  } catch (err) {
    console.error('【手动发放次数异常】', err);

    return res.json({ code: -99, msg: String(err) });

  }

});
// ========== HTTP 请求封装 ==========
function httpsRequest(urlStr, method = 'GET', postData = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);

    const bodyBuffer = postData ? Buffer.from(postData, 'utf8') : null;

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Accept': 'application/json',
        'User-Agent': 'youwantoffer-api/1.0',
        ...(bodyBuffer ? { 'Content-Length': bodyBuffer.length } : {}),
        ...extraHeaders
      }

    };

    const request = https.request(options, response => {
      const chunks = [];

      response.on('data', chunk => chunks.push(chunk));

      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');

        try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(new Error('微信返回非JSON')); }
      });

    });

    request.on('error', reject);

    if (bodyBuffer) request.write(bodyBuffer);

    request.end();

  });

}
// ========== V3 签名 ==========
function buildV3Signature(method, urlPath, timestamp, nonce, body, privateKeyRaw) {
  const signStr = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;

  return crypto.createSign('RSA-SHA256').update(signStr, 'utf8').sign(privateKeyRaw, 'base64');

}

function genOutTradeNo() {
  return Date.now() + crypto.randomBytes(6).toString('hex');

}
// ========== Mock 下单 ==========
router.post('/createPayOrder', async (req, res) => {
  try {
    const { openId, type } = req.body;

    if (!openId || !type) return res.json({ errcode: -1, errmsg: '参数缺失' });

    const outTradeNo = genOutTradeNo();

    const goodsName = type === 'resume' ? '简历诊断' : '面试建议';

    console.log('【Mock下单】创建', goodsName, '订单，订单号：', outTradeNo, '用户openid：', openId);

    await db.collection('orders').add({ data: {
      openid: openId, type, goods_name: goodsName, total_fee: 1, out_trade_no: outTradeNo,
      trade_state: 'NOTPAY', benefit_granted: 0,
      create_time: new Date().toLocaleString('zh-CN').replace(/\//g, '-')
    } });

    return res.json({ errcode: 0, prepay_id: `mock_${outTradeNo}`, out_trade_no: outTradeNo });

  } catch (err) {
    console.error('【Mock下单异常】', err);

    return res.json({ errcode: -99, errmsg: String(err) });

  }

});
// ========== 查询订单 ==========
router.post('/queryPayOrder', async (req, res) => {
  try {
    const { out_trade_no } = req.body;

    if (!out_trade_no) return res.json({ errcode: -1, errmsg: '订单号缺失' });

    const orderRes = await withTimeout(db.collection('orders').where({ 'data.out_trade_no': out_trade_no }).get());

    if (orderRes.data.length === 0) return res.json({ errcode: -2, errmsg: '订单不存在' });

    const order = orderRes.data[0].data;

    console.log('【订单查询】订单号', out_trade_no, '类型：', order.type, '支付状态：', order.trade_state);

    return res.json({
      errcode: 0,
      out_trade_no: order.out_trade_no,
      trade_state: order.trade_state,
      trade_state_desc: order.trade_state === 'SUCCESS' ? '支付成功' : '待支付',
      amount: { total: order.total_fee, currency: 'CNY' },
      payer: { openid: order.openid },
      success_time: order.pay_time
    });

  } catch (err) {
    console.error('【订单查询异常】', err);

    return res.json({ errcode: -99, msg: String(err) });

  }

});
// ========== 订单列表 ==========
router.post('/getUserOrderList', async (req, res) => {
  try {
    const listRes = await withTimeout(db.collection('orders').orderBy('create_time', 'desc').limit(100).get());

    console.log('【订单列表查询】拉取全部订单总数：', listRes.data.length);

    return res.json({ code: 0, data: { list: listRes.data, total: listRes.data.length } });

  } catch (err) {
    console.error('【订单列表查询异常】', err);

    return res.json({ code: -99, msg: String(err) });

  }

});
// ========== 微信 V3 下单 ==========
router.post('/createWxPayOrder', async (req, res) => {
  try {
    const { openId, type } = req.body;

    if (!openId || !type) return res.json({ errcode: -1, errmsg: '参数缺失' });

    const appid = process.env.APP_ID;
    const mchid = process.env.WX_MCH_ID;
    const serialNo = process.env.WX_CERT_SERIAL;
    const v3Key = process.env.WX_API_V3_KEY;
    const notifyUrl = 'https://api.youwantoffer.cn/api/wxpayNotify';
    if (!appid || !mchid || !serialNo || !PRIVATE_KEY_RAW) return res.json({ errcode: -2, errmsg: '商户配置缺失' });
    const outTradeNo = genOutTradeNo();
    const description = type === 'resume' ? '简历诊断' : '面试建议';
    const bodyObj = {
      appid, mchid, out_trade_no: outTradeNo, description, notify_url: notifyUrl,
      amount: { total: 1, currency: 'CNY' }, payer: { openid: openId }
    };
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomBytes(16).toString('hex');
    const urlPath = '/v3/pay/transactions/jsapi';
    const bodyStr = JSON.stringify(bodyObj);
    const signature = buildV3Signature('POST', urlPath, timestamp, nonce, bodyStr, PRIVATE_KEY_RAW);
    const auth = `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${serialNo}",signature="${signature}"`;
    console.log('【V3下单】发起', description, '订单，订单号：', outTradeNo, '用户：', openId);
    const wxResult = await httpsRequest('https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi', 'POST', bodyStr, { Authorization: auth });
    if (wxResult.code || !wxResult.prepay_id) {
      console.error('【V3下单失败】微信返回', wxResult);
      return res.json({ errcode: -3, errmsg: '微信下单失败', wxResult });
    }
    const payPackage = `prepay_id=${wxResult.prepay_id}`;
    const paySignRaw = `${appid}\n${timestamp}\n${nonce}\n${payPackage}\n`;
    const paySign = crypto.createSign('RSA-SHA256').update(paySignRaw, 'utf8').sign(PRIVATE_KEY_RAW, 'base64');
    await db.collection('orders').add({ data: {
      openid: openId, type, goods_name: description, total_fee: 1, out_trade_no: outTradeNo,
      prepay_id: wxResult.prepay_id, trade_state: 'NOTPAY', benefit_granted: 0,
      create_time: new Date().toLocaleString('zh-CN').replace(/\//g, '-')
    } });
    console.log('【V3下单】订单入库完成，订单号：', outTradeNo, '业务类型：', type);
    return res.json({
      errcode: 0,
      prepay_id: wxResult.prepay_id,
      out_trade_no: outTradeNo,
      payParams: { timeStamp: timestamp, nonceStr: nonce, package: payPackage, signType: 'RSA', paySign }
    });
  } catch (err) {
    console.error('【V3下单全局异常】', err);
    return res.json({ errcode: -99, errmsg: String(err) });
  }
});
// ==========================================================
// ✅ 阶段 2B：微信支付回调（标准验签，生产级）
// ==========================================================
router.post('/wxpayNotify', async (req, res) => {
  try {
    const serial = req.headers['wechatpay-serial'];
    const signature = req.headers['wechatpay-signature'];
    const timestamp = req.headers['wechatpay-timestamp'];
    const nonce = req.headers['wechatpay-nonce'];
    const rawBody = req.rawBody || JSON.stringify(req.body);
    // 1️⃣ 基础校验
    if (!serial || !signature || !timestamp || !nonce || !rawBody) {
      console.log('【回调拦截】缺少V3请求头');
      return res.json({ code: 'FAIL' });
    }
    // 2️⃣ 公钥ID校验
    if (serial !== WECHAT_PUB_ID) {
      console.log('【回调拦截】公钥ID不匹配，传入serial：', serial, '配置公钥ID：', WECHAT_PUB_ID);
      return res.json({ code: 'FAIL' });
    }
    // 3️⃣ 验签（先验签，后解密）
    const signStr = `${timestamp}\n${nonce}\n${rawBody}\n`;
    const valid = crypto.createVerify('RSA-SHA256').update(signStr, 'utf8').verify(WECHAT_PUB_KEY_RAW, signature, 'base64');
    if (!valid) {
      console.log('【回调拦截】RSA验签失败');
      return res.json({ code: 'FAIL' });
    }
    console.log('【回调验签】✅ 验签通过，原始请求体：', rawBody);
    // 4️⃣ 解密
    const { resource } = req.body;
    const { ciphertext, nonce: aesNonce, associated_data } = resource;
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(process.env.WX_API_V3_KEY), Buffer.from(aesNonce));
    decipher.setAuthTag(Buffer.from(ciphertext, 'base64').slice(-16));
    decipher.setAAD(Buffer.from(associated_data || ''));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64').slice(0, -16)),
      decipher.final()
    ]).toString('utf8');
    const payInfo = JSON.parse(plain);
    console.log('【回调解密】解密后支付报文：', payInfo);
    if (payInfo.trade_state !== 'SUCCESS') {
      console.log('【回调】订单未支付成功，无需发放次数');
      return res.json({ code: 'SUCCESS' });
    }
    // 5️⃣ 更新订单（幂等）
    const updateRes = await db.collection('orders').where({
      'data.out_trade_no': payInfo.out_trade_no,
      'data.benefit_granted': 0
    }).update({
      'data.trade_state': 'SUCCESS',
      'data.benefit_granted': 1,
      'data.pay_time': new Date().toLocaleString('zh-CN').replace(/\//g, '-'),
      'data.transaction_id': payInfo.transaction_id
    });
    // 6️⃣ 发放次数（已完善interview分支，增加日志区分业务）
    if (updateRes.updated > 0) {
      const order = (await db.collection('orders').where({ 'data.out_trade_no': payInfo.out_trade_no }).get()).data[0].data;
      console.log('【回调发放次数】订单业务类型：', order.type, '用户openid：', order.openid);
      if (order.type === 'resume') {
        await db.collection('users').where({ openid: order.openid }).update({ payResumeCount: cmd.inc(1) });
        console.log('【回调】简历付费次数发放完成', order.openid);
      } else if (order.type === 'interview') {
        await db.collection('users').where({ openid: order.openid }).update({ payInterviewCount: cmd.inc(1) });
        console.log('【回调】面试付费次数发放完成', order.openid);
      } else console.log('【回调警告】未知订单type，不发放次数', order.type);
    } else console.log('【回调幂等】订单已发放过次数，跳过更新');
    return res.json({ code: 'SUCCESS' });
  } catch (err) {
    console.error('【支付回调】全局异常', err);
    return res.json({ code: 'FAIL' });
  }
});

module.exports = router;
