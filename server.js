const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Rate limit (เรียบง่าย)
const requests = new Map();
const cleanupInterval = setInterval(() => {
  const oneMinuteAgo = Date.now() - 60000;
  for (const [ip, data] of requests.entries()) {
    if (data.lastRequest < oneMinuteAgo) requests.delete(ip);
  }
}, 60000);

function simpleRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();

  if (!requests.has(ip)) {
    requests.set(ip, { count: 1, lastRequest: now });
    return next();
  }

  const userData = requests.get(ip);
  if (now - userData.lastRequest > 60000) {
    userData.count = 1;
  } else {
    userData.count++;
  }
  userData.lastRequest = now;

  if (userData.count > 20) {
    return res.status(429).send(`<h2>🚫 คำขอมากเกินไป</h2><a href="/">กลับ</a>`);
  }

  next();
}

// Validate URL
function isValidUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Escape HTML
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Fallback ด้วย Puppeteer
async function fetchWithPuppeteer(url) {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  const content = await page.content();
  await browser.close();
  return content;
}

// สร้างหน้าสำเร็จ
function generateSuccessPage(url, sourceCode) {
  const escapedCode = escapeHtml(sourceCode);
  const lines = sourceCode.split('\n').length;
  const size = Math.round(sourceCode.length / 1024);

  return `<!DOCTYPE html>
<html lang="th">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Source Code</title>
<style>
  body { font-family: Arial; background: #1a1a1a; color: #e0e0e0; padding: 20px; }
  .btn { background: #4CAF50; color: white; padding: 10px; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px; }
  .btn-secondary { background: #666; }
  pre { background: #0d1117; padding: 20px; border-radius: 8px; white-space: pre-wrap; }
</style>
</head>
<body>
  <h2>📄 Source Code</h2>
  <p><strong>URL:</strong> ${escapeHtml(url)}</p>
  <p><strong>บรรทัด:</strong> ${lines}</p>
  <p><strong>ขนาด:</strong> ${size} KB</p>
  <button class="btn" onclick="copyCode()">📋 คัดลอกโค้ด</button>
  <button class="btn btn-secondary" onclick="downloadCode()">💾 ดาวน์โหลด</button>
  <a href="/" class="btn btn-secondary">🔙 กลับ</a>
  <pre id="source-code">${escapedCode}</pre>
  <script>
    function copyCode() {
      const code = document.getElementById('source-code').textContent;
      navigator.clipboard.writeText(code).then(() => alert("คัดลอกแล้ว!")).catch(() => alert("คัดลอกไม่ได้"));
    }
    function downloadCode() {
      const code = document.getElementById('source-code').textContent;
      const blob = new Blob([code], { type: 'text/plain' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'source_code.html';
      link.click();
    }
  </script>
</body></html>`;
}

// ดึงโค้ดจากเว็บ
app.post('/fetch-code', simpleRateLimit, async (req, res) => {
  const { url } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).send(`<h2>❌ URL ไม่ถูกต้อง</h2><a href="/">กลับ</a>`);
  }

  console.log(`Fetching: ${url}`);

  try {
    const response = await axios.get(url, {
      timeout: 15000,
      maxContentLength: 5 * 1024 * 1024,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'text/html',
        'Referer': url,
      }
    });

    if (typeof response.data !== 'string') {
      return res.status(400).send(`<h2>❌ ไม่ใช่ไฟล์ text</h2><a href="/">กลับ</a>`);
    }

    if (response.data.length > 2 * 1024 * 1024) {
      return res.status(413).send(`<h2>📦 ไฟล์ใหญ่เกินไป</h2><a href="/">กลับ</a>`);
    }

    return res.send(generateSuccessPage(url, response.data));

  } catch (error) {
    if (error.response?.status === 403) {
      try {
        console.log("🔁 ลองใช้ Puppeteer เพราะโดนบล็อก");
        const html = await fetchWithPuppeteer(url);
        return res.send(generateSuccessPage(url, html));
      } catch (err) {
        return res.status(500).send(`<h2>❌ ดึงผ่าน Puppeteer ไม่สำเร็จ</h2><p>${escapeHtml(err.message)}</p><a href="/">กลับ</a>`);
      }
    }

    return res.status(500).send(`<h2>❌ ดึงข้อมูลล้มเหลว</h2><p>${escapeHtml(error.message)}</p><a href="/">กลับ</a>`);
  }
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// 404
app.use((req, res) => res.status(404).send(`<h2>🔍 ไม่พบหน้า</h2><a href="/">กลับ</a>`));

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).send(`<h2>💥 เกิดข้อผิดพลาด</h2><a href="/">กลับ</a>`);
});

// Start
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📅 Started: ${new Date().toLocaleString('th-TH')}`);
});

process.on('SIGINT', () => { clearInterval(cleanupInterval); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { clearInterval(cleanupInterval); server.close(); });
