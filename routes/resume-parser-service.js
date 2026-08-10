'use strict';

const crypto = require('crypto');
const path = require('path');

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(['.doc', '.docx', '.pdf', '.txt']);
const FILE_REQUIREMENT_MESSAGE = '目前只能上传5M内的.doc、.docx、PDF、TXT文件哦';

function createParserError(code, message = FILE_REQUIREMENT_MESSAGE) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getExtension(fileName) {
  return path.extname(String(fileName || '')).toLowerCase();
}

function validateResumeFile(file) {
  const extension = getExtension(file?.originalname);
  if (!SUPPORTED_EXTENSIONS.has(extension)) throw createParserError('UNSUPPORTED_FILE_TYPE');
  if (!Buffer.isBuffer(file?.buffer) || file.buffer.length === 0) {
    throw createParserError('EMPTY_FILE', '没有读取到简历内容，请重新选择文件');
  }
  if (file.buffer.length > MAX_FILE_SIZE) throw createParserError('FILE_TOO_LARGE');
  return extension;
}

function cleanResumeText(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractText(buffer, extension) {
  if (extension === '.txt') return buffer.toString('utf8');
  if (extension === '.pdf') {
    const pdfParse = require('pdf-parse');
    return (await pdfParse(buffer)).text;
  }
  if (extension === '.docx') {
    const mammoth = require('mammoth');
    return (await mammoth.extractRawText({ buffer })).value;
  }
  const WordExtractor = require('word-extractor');
  const document = await new WordExtractor().extract(buffer);
  return document.getBody();
}

async function parseResumeFile(file) {
  const extension = validateResumeFile(file);
  let extracted;
  try {
    extracted = await extractText(file.buffer, extension);
  } catch (error) {
    const parserError = createParserError('FILE_PARSE_FAILED', '简历内容解析失败，请确认文件未损坏后重试');
    parserError.cause = error;
    throw parserError;
  }
  const resumeInfo = cleanResumeText(extracted);
  if (!resumeInfo) throw createParserError('EMPTY_RESUME_TEXT', '没有识别到简历文字，请换一份文件重试');

  const digest = crypto.createHash('sha256').update(file.buffer).digest('hex').slice(0, 20);
  return {
    resumeInfo,
    resume_id: `resume_${digest}`,
    fileName: file.originalname,
    fileType: extension.slice(1)
  };
}

module.exports = {
  MAX_FILE_SIZE,
  SUPPORTED_EXTENSIONS,
  FILE_REQUIREMENT_MESSAGE,
  cleanResumeText,
  validateResumeFile,
  parseResumeFile
};
