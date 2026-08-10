'use strict';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = ['.doc', '.docx', '.pdf', '.txt'];
const FILE_REQUIREMENT_MESSAGE = '目前只能上传5M内的.doc、.docx、PDF、TXT文件哦';

function extensionOf(fileName) {
  const normalized = String(fileName || '').toLowerCase();
  const dotIndex = normalized.lastIndexOf('.');
  return dotIndex >= 0 ? normalized.slice(dotIndex) : '';
}

function validateSelectedFile(file) {
  const extension = extensionOf(file?.name);
  const size = Number(file?.size || 0);
  return Boolean(file?.path && SUPPORTED_EXTENSIONS.includes(extension) && size > 0 && size <= MAX_FILE_SIZE);
}

function uploadResumeFile({ baseUrl, file }) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${baseUrl}/api/resume/parse`,
      filePath: file.path,
      name: 'file',
      success(response) {
        let body;
        try {
          body = JSON.parse(response.data || '{}');
        } catch (error) {
          reject(new Error('简历解析服务返回异常，请稍后重试'));
          return;
        }
        if (response.statusCode !== 200 || body.code !== 0 || !body.data?.resumeInfo) {
          reject(new Error(body.msg || '简历解析失败，请稍后重试'));
          return;
        }
        resolve(body.data);
      },
      fail() {
        reject(new Error('简历上传失败，请检查网络后重试'));
      }
    });
  });
}

module.exports = {
  MAX_FILE_SIZE,
  SUPPORTED_EXTENSIONS,
  FILE_REQUIREMENT_MESSAGE,
  validateSelectedFile,
  uploadResumeFile
};
