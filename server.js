const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Simple rate limiting
const requests = new Map();
const cleanupInterval = setInterval(() => {
  const oneMinuteAgo = Date.now() - 60000;
  for (const [ip, data] of requests.entries()) {
    if (data.lastRequest < oneMinuteAgo) {
      requests.delete(ip);
    }
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
    userData.lastRequest = now;
  } else {
    userData.count++;
    userData.lastRequest = now;
  }
  
  if (userData.count > 20) {
    return res.status(429).send(`
      <h2>🚫 คำขอมากเกินไป</h2>
      <p>กรุณารอสักครู่แล้วลองใหม่</p>
      <a href="/">กลับ</a>
    `);
  }
  
  next();
}

// URL validation
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// HTML escape
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Generate simple success page
function generateSuccessPage(url, sourceCode) {
  const escapedCode = escapeHtml(sourceCode);
  const lines = sourceCode.split('\n').length;
  const size = Math.round(sourceCode.length / 1024);
  
  return `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Source Code</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          background: #1a1a1a;
          color: #e0e0e0;
          margin: 0;
          padding: 20px;
        }
        .header {
          background: #2d2d2d;
          padding: 20px;
          border-radius: 8px;
          margin-bottom: 20px;
        }
        .header h2 {
          color: #4CAF50;
          margin: 0 0 10px 0;
        }
        .info {
          color: #888;
          font-size: 14px;
        }
        .controls {
          margin: 20px 0;
        }
        .btn {
          background: #4CAF50;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 4px;
          cursor: pointer;
          margin-right: 10px;
          text-decoration: none;
          display: inline-block;
        }
        .btn:hover {
          background: #45a049;
        }
        .btn-secondary {
          background: #666;
        }
        .btn-secondary:hover {
          background: #555;
        }
        .code-container {
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 8px;
          overflow: hidden;
        }
        .code-header {
          background: #21262d;
          padding: 15px;
          border-bottom: 1px solid #30363d;
          font-weight: bold;
        }
        pre {
          margin: 0;
          padding: 20px;
          overflow-x: auto;
          font-family: 'Courier New', monospace;
          font-size: 13px;
          line-height: 1.5;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .notification {
          position: fixed;
          top: 20px;
          right: 20px;
          background: #4CAF50;
          color: white;
          padding: 15px;
          border-radius: 4px;
          display: none;
          z-index: 1000;
        }
        @media (max-width: 768px) {
          body { padding: 10px; }
          .controls { text-align: center; }
          .btn { display: block; margin: 10px 0; }
        }
      </style>
    </head>
    <body>
      <div class="notification" id="notification">
        ✅ คัดลอกโค้ดสำเร็จ!
      </div>

      <div class="header">
        <h2>📄 Source Code</h2>
        <div class="info">
          <div><strong>URL:</strong> ${escapeHtml(url)}</div>
          <div><strong>บรรทัด:</strong> ${lines.toLocaleString()}</div>
          <div><strong>ขนาด:</strong> ${size} KB</div>
        </div>
      </div>

      <div class="controls">
        <button onclick="copyCode()" class="btn">📋 คัดลอกโค้ด</button>
        <button onclick="downloadCode()" class="btn btn-secondary">💾 ดาวน์โหลด</button>
        <a href="/" class="btn btn-secondary">🔙 กลับ</a>
      </div>

      <div class="code-container">
        <div class="code-header">Source Code</div>
        <pre id="source-code">${escapedCode}</pre>
      </div>

      <script>
        function copyCode() {
          const code = document.getElementById('source-code').textContent;
          
          if (navigator.clipboard) {
            navigator.clipboard.writeText(code).then(() => {
              showNotification();
            }).catch(() => {
              fallbackCopy(code);
            });
          } else {
            fallbackCopy(code);
          }
        }

        function fallbackCopy(text) {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          document.body.appendChild(textarea);
          textarea.select();
          try {
            document.execCommand('copy');
            showNotification();
          } catch (err) {
            alert('ไม่สามารถคัดลอกได้');
          }
          document.body.removeChild(textarea);
        }

        function downloadCode() {
          const code = document.getElementById('source-code').textContent;
          const url = '${escapeHtml(url)}';
          const filename = 'source_code.html';
          
          const blob = new Blob([code], { type: 'text/html' });
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(link.href);
        }

        function showNotification() {
          const notification = document.getElementById('notification');
          notification.style.display = 'block';
          setTimeout(() => {
            notification.style.display = 'none';
          }, 3000);
        }
      </script>
    </body>
    </html>
  `;
}

// Main route
app.post('/fetch-code', simpleRateLimit, async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).send(`
      <h2>❌ กรุณาใส่ URL</h2>
      <a href="/">กลับ</a>
    `);
  }

  if (!isValidUrl(url)) {
    return res.status(400).send(`
      <h2>❌ URL ไม่ถูกต้อง</h2>
      <p>กรุณาใส่ URL ที่ขึ้นต้นด้วย http:// หรือ https://</p>
      <a href="/">กลับ</a>
    `);
  }

  console.log(`Fetching: ${url}`);

  try {
    const response = await axios.get(url, {
      timeout: 15000,
      maxContentLength: 5 * 1024 * 1024, // 5MB
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const sourceCode = response.data;
    
    if (typeof sourceCode !== 'string') {
      return res.status(400).send(`
        <h2>❌ ไฟล์ไม่ใช่ text</h2>
        <a href="/">กลับ</a>
      `);
    }

    if (sourceCode.length > 2 * 1024 * 1024) { // 2MB
      return res.status(413).send(`
        <h2>📦 ไฟล์ใหญ่เกินไป</h2>
        <p>ขนาดไฟล์: ${Math.round(sourceCode.length / 1024 / 1024)} MB</p>
        <a href="/">กลับ</a>
      `);
    }

    res.send(generateSuccessPage(url, sourceCode));
    
  } catch (error) {
    console.error('Error:', error.message);
    
    let errorMsg = 'เกิดข้อผิดพลาดในการดึงข้อมูล';
    
    if (error.code === 'ENOTFOUND') {
      errorMsg = 'ไม่พบเว็บไซต์นี้';
    } else if (error.code === 'ETIMEDOUT') {
      errorMsg = 'หมดเวลาในการเชื่อมต่อ';
    } else if (error.response?.status === 404) {
      errorMsg = 'ไม่พบหน้าเว็บนี้ (404)';
    } else if (error.response?.status === 403) {
      errorMsg = 'ไม่อนุญาตให้เข้าถึง (403)';
    }

    res.status(500).send(`
      <h2>❌ ${errorMsg}</h2>
      <p>URL: ${escapeHtml(url)}</p>
      <p>ข้อผิดพลาด: ${escapeHtml(error.message)}</p>
      <a href="/">กลับ</a>
    `);
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).send(`
    <h2>🔍 ไม่พบหน้า</h2>
    <p>หน้าที่คุณต้องการไม่มีอยู่</p>
    <a href="/">กลับหน้าแรก</a>
  `);
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).send(`
    <h2>💥 เซิร์ฟเวอร์เกิดปัญหา</h2>
    <p>กรุณาลองใหม่อีกครั้ง</p>
    <a href="/">กลับ</a>
  `);
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📅 Started: ${new Date().toLocaleString('th-TH')}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  clearInterval(cleanupInterval);
  server.close();
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  clearInterval(cleanupInterval);
  server.close();
  process.exit(0);
});