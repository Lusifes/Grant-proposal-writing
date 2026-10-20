'use strict';
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const { UPLOAD_DIR } = require('../db');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 12);
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  }
});

const upload = multer({ storage, limits: { fileSize: 40 * 1024 * 1024 } });

async function extractPdfText(filePath) {
  const pdfParse = require('pdf-parse/lib/pdf-parse.js');
  const data = await pdfParse(fs.readFileSync(filePath));
  return data.text || '';
}

module.exports = { upload, extractPdfText, UPLOAD_DIR };
