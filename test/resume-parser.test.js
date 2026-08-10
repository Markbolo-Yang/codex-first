'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MAX_FILE_SIZE,
  FILE_REQUIREMENT_MESSAGE,
  validateResumeFile,
  parseResumeFile
} = require('../routes/resume-parser-service');
const { parseMultipartFile } = require('../routes/resume-parser');
const {
  validateSelectedFile
} = require('../pages/resume/resume-file-parser');

test('accepts the supported resume formats up to 5MB on both client and server', () => {
  for (const extension of ['doc', 'docx', 'pdf', 'txt', 'PDF']) {
    const file = { name: `resume.${extension}`, path: '/tmp/resume', size: MAX_FILE_SIZE };
    assert.equal(validateSelectedFile(file), true);
    assert.doesNotThrow(() => validateResumeFile({
      originalname: file.name,
      buffer: Buffer.alloc(1)
    }));
  }
});

test('rejects images, unknown formats and files over 5MB', () => {
  assert.equal(validateSelectedFile({ name: 'resume.png', path: '/tmp/a', size: 10 }), false);
  assert.equal(validateSelectedFile({ name: 'resume.pdf', path: '/tmp/a', size: MAX_FILE_SIZE + 1 }), false);
  assert.throws(
    () => validateResumeFile({ originalname: 'resume.jpg', buffer: Buffer.from('x') }),
    error => error.code === 'UNSUPPORTED_FILE_TYPE' && error.message === FILE_REQUIREMENT_MESSAGE
  );
});

test('extracts and cleans real text from an uploaded TXT resume', async () => {
  const parsed = await parseResumeFile({
    originalname: '真实简历.TXT',
    buffer: Buffer.from('教育经历\r\n\r\n\r\n项目经历\t产品经理', 'utf8')
  });
  assert.equal(parsed.resumeInfo, '教育经历\n\n项目经历 产品经理');
  assert.equal(parsed.fileType, 'txt');
  assert.match(parsed.resume_id, /^resume_[a-f0-9]{20}$/);
});

test('reads the file field from a mini-program multipart upload', () => {
  const boundary = 'test-boundary';
  const body = Buffer.from([
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="resume.txt"',
    'Content-Type: text/plain',
    '',
    '真实简历内容',
    `--${boundary}--`,
    ''
  ].join('\r\n'));
  const file = parseMultipartFile(`multipart/form-data; boundary=${boundary}`, body);
  assert.equal(file.originalname, 'resume.txt');
  assert.equal(file.buffer.toString(), '真实简历内容');
});
