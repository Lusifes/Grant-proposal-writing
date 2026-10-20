'use strict';
// 服务端密钥加密：API Key 加密落盘（AES-256-GCM），密钥文件仅存在于本机 data 目录。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const keyFile = path.join(__dirname, '..', '..', 'data', '.secret');

function getKey() {
  if (fs.existsSync(keyFile)) return fs.readFileSync(keyFile);
  const k = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, k, { mode: 0o600 });
  return k;
}

function encrypt(text) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString('base64')).join('.');
}

function decrypt(payload) {
  const key = getKey();
  const [ivB, tagB, dataB] = String(payload).split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivB);
  decipher.setAuthTag(tagB);
  return Buffer.concat([decipher.update(dataB), decipher.final()]).toString('utf8');
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '…' + key.slice(-4);
}

module.exports = { encrypt, decrypt, maskKey };
