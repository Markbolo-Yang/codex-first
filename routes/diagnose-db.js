'use strict';

const cloudbase = require('@cloudbase/node-sdk');

const tcbSdk = cloudbase.init({
  secretId: process.env.TCB_SECRET_ID,
  secretKey: process.env.TCB_SECRET_KEY,
  env: process.env.TCB_ENV,
  region: 'ap-shanghai'
});

const db = tcbSdk.database();

function withTimeout(promise, ms = 3000, errMsg = 'DB_OPERATION_TIMEOUT') {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(errMsg)), ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

module.exports = {
  db,
  cmd: db.command,
  withTimeout
};
