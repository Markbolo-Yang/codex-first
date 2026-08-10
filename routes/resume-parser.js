'use strict';

const express = require('express');
const {
  MAX_FILE_SIZE,
  FILE_REQUIREMENT_MESSAGE,
  parseResumeFile
} = require('./resume-parser-service');

const router = express.Router();
const MAX_MULTIPART_SIZE = MAX_FILE_SIZE + 64 * 1024;

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_MULTIPART_SIZE) {
        tooLarge = true;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        const error = new Error(FILE_REQUIREMENT_MESSAGE);
        error.code = 'FILE_TOO_LARGE';
        reject(error);
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function parseMultipartFile(contentType, body) {
  const boundaryMatch = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    const error = new Error('上传请求格式不正确');
    error.code = 'INVALID_MULTIPART';
    throw error;
  }
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  let cursor = 0;
  while ((cursor = body.indexOf(boundary, cursor)) !== -1) {
    const headerStart = cursor + boundary.length + 2;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd === -1) break;
    const headers = body.subarray(headerStart, headerEnd).toString('utf8');
    const disposition = headers.match(/content-disposition:[^\r\n]*name="file"[^\r\n]*filename="([^"]*)"/i);
    const nextBoundary = body.indexOf(boundary, headerEnd + 4);
    if (disposition && nextBoundary !== -1) {
      return {
        originalname: disposition[1],
        buffer: body.subarray(headerEnd + 4, nextBoundary - 2)
      };
    }
    cursor = headerEnd + 4;
  }
  const error = new Error('没有收到简历文件');
  error.code = 'FILE_MISSING';
  throw error;
}

router.post('/parse', async (req, res) => {
  try {
    const body = await readRequestBody(req);
    const file = parseMultipartFile(req.headers['content-type'], body);
    const result = await parseResumeFile(file);
    return res.json({ code: 0, data: result });
  } catch (error) {
    console.error('【简历解析失败】', error.code || error.message);
    const clientErrors = new Set([
      'UNSUPPORTED_FILE_TYPE', 'FILE_TOO_LARGE', 'EMPTY_FILE', 'EMPTY_RESUME_TEXT',
      'FILE_PARSE_FAILED', 'FILE_MISSING', 'INVALID_MULTIPART'
    ]);
    return res.status(clientErrors.has(error.code) ? 400 : 500).json({
      code: error.code || 'RESUME_PARSE_FAILED',
      msg: error.message || '简历解析失败，请稍后重试'
    });
  }
});

module.exports = router;
module.exports.parseMultipartFile = parseMultipartFile;
