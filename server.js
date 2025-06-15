const express = require('express');
const axios = require('axios');
const { JSDOM } = require('jsdom');
const puppeteer = require('puppeteer');
const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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
  
  if (userData.count > 30) { // เพิ่ม limit เป็น 30
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

// Enhanced headers for different websites
function getRandomHeaders() {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ];
  
  return {
    'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0'
  };
}

// Fetch with multiple methods
async function fetchWithAxios(url, options = {}) {
  const config = {
    timeout: 20000,
    maxContentLength: 10 * 1024 * 1024, // 10MB
    maxRedirects: 5,
    headers: getRandomHeaders(),
    validateStatus: status => status < 500, // Accept 4xx errors
    ...options
  };

  try {
    const response = await axios.get(url, config);
    return { success: true, data: response.data, status: response.status };
  } catch (error) {
    return { success: false, error: error.message, status: error.response?.status };
  }
}

async function fetchWithPuppeteer(url) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    });
    
    const page = await browser.newPage();
    
    // Set viewport and user agent
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(getRandomHeaders()['User-Agent']);
    
    // Set extra headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8'
    });
    
    // Navigate with timeout
    await page.goto(url, { 
      waitUntil: 'networkidle2', 
      timeout: 30000 
    });
    
    // Wait a bit for dynamic content
    await page.waitForTimeout(2000);
    
    // Get the page content
    const content = await page.content();
    
    return { success: true, data: content };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Try different methods to fetch content
async function smartFetch(url) {
  console.log(`🔍 Attempting to fetch: ${url}`);
  
  // Method 1: Standard Axios
  console.log('📡 Trying Axios method...');
  let result = await fetchWithAxios(url);
  
  if (result.success && result.data && typeof result.data === 'string') {
    console.log('✅ Axios method succeeded');
    return result;
  }
  
  // Method 2: Axios with different headers
  console.log('🔄 Trying Axios with mobile headers...');
  const mobileHeaders = {
    ...getRandomHeaders(),
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1'
  };
  
  result = await fetchWithAxios(url, { headers: mobileHeaders });
  
  if (result.success && result.data && typeof result.data === 'string') {
    console.log('✅ Mobile headers method succeeded');
    return result;
  }
  
  // Method 3: Axios without SSL verification (for some sites)
  console.log('🔓 Trying without SSL verification...');
  result = await fetchWithAxios(url, { 
    httpsAgent: new (require('https')).Agent({ rejectUnauthorized: false })
  });
  
  if (result.success && result.data && typeof result.data === 'string') {
    console.log('✅ No SSL verification method succeeded');
    return result;
  }
  
  // Method 4: Puppeteer for JavaScript-heavy sites
  console.log('🤖 Trying Puppeteer method...');
  result = await fetchWithPuppeteer(url);
  
  if (result.success && result.data) {
    console.log('✅ Puppeteer method succeeded');
    return result;
  }
  
  // Method 5: Last resort with curl-like approach
  console.log('🔧 Trying curl-like method...');
  try {
    const curlResult = await fetchWithAxios(url, {
      headers: {
        'User-Agent': 'curl/7.68.0',
        'Accept': '*/*'
      },
      timeout: 15000
    });
    
    if (curlResult.success) {
      console.log('✅ Curl-like method succeeded');
      return curlResult;
    }
  } catch (error) {
    console.log('❌ Curl-like method failed');
  }
  
  return { success: false, error: 'ไม่สามารถเข้าถึงเว็บไซต์ได้ด้วยวิธีใดๆ' };
}

// Enhanced success page with more features
function generateSuccessPage(url, sourceCode, method = 'axios') {
  const escapedCode = escapeHtml(sourceCode);
  const lines = sourceCode.split('\n').length;
  const size = Math.round(sourceCode.length / 1024);
  
  return `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Source Code - Enhanced Fetcher</title>
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
          color: #e0e0e0;
          margin: 0;
          padding: 20px;
          min-height: 100vh;
        }
        .header {
          background: linear-gradient(135deg, #2d2d2d 0%, #3d3d3d 100%);
          padding: 25px;
          border-radius: 12px;
          margin-bottom: 20px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        }
        .header h2 {
          color: #4CAF50;
          margin: 0 0 15px 0;
          font-size: 24px;
        }
        .info {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 10px;
          color: #bbb;
          font-size: 14px;
        }
        .info-item {
          background: rgba(255, 255, 255, 0.05);
          padding: 10px;
          border-radius: 6px;
        }
        .method-badge {
          display: inline-block;
          background: #4CAF50;
          color: white;
          padding: 4px 12px;
          border-radius: 15px;
          font-size: 12px;
          font-weight: bold;
          text-transform: uppercase;
        }
        .controls {
          margin: 20px 0;
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }
        .btn {
          background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
          color: white;
          border: none;
          padding: 12px 20px;
          border-radius: 8px;
          cursor: pointer;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-weight: 500;
          transition: all 0.3s ease;
        }
        .btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);
        }
        .btn-secondary {
          background: linear-gradient(135deg, #666 0%, #555 100%);
        }
        .btn-secondary:hover {
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }
        .code-container {
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        }
        .code-header {
          background: linear-gradient(135deg, #21262d 0%, #30363d 100%);
          padding: 20px;
          border-bottom: 1px solid #30363d;
          font-weight: bold;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .code-stats {
          font-size: 14px;
          color: #7d8590;
        }
        pre {
          margin: 0;
          padding: 25px;
          overflow-x: auto;
          font-family: 'Fira Code', 'Courier New', monospace;
          font-size: 13px;
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-word;
          background: #0d1117;
        }
        .notification {
          position: fixed;
          top: 20px;
          right: 20px;
          background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
          color: white;
          padding: 15px 20px;
          border-radius: 8px;
          display: none;
          z-index: 1000;
          box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);
        }
        .search-box {
          background: rgba(255, 255, 255, 0.05);
          padding: 15px;
          border-radius: 8px;
          margin-bottom: 20px;
        }
        .search-box input {
          width: 100%;
          padding: 10px;
          border: 1px solid #444;
          border-radius: 6px;
          background: #2d2d2d;
          color: #e0e0e0;
          font-size: 14px;
        }
        .search-box input:focus {
          outline: none;
          border-color: #4CAF50;
        }
        @media (max-width: 768px) {
          body { padding: 10px; }
          .controls { 
            flex-direction: column;
          }
          .btn { 
            justify-content: center;
          }
          .info {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </head>
    <body>
      <div class="notification" id="notification">
        ✅ คัดลอกโค้ดสำเร็จ!
      </div>

      <div class="header">
        <h2>📄 Source Code Retrieved Successfully</h2>
        <div class="info">
          <div class="info-item">
            <strong>🌐 URL:</strong><br>
            <span style="word-break: break-all;">${escapeHtml(url)}</span>
          </div>
          <div class="info-item">
            <strong>📊 สถิติ:</strong><br>
            ${lines.toLocaleString()} บรรทัด • ${size} KB
          </div>
          <div class="info-item">
            <strong>🔧 วิธีการ:</strong><br>
            <span class="method-badge">${method}</span>
          </div>
          <div class="info-item">
            <strong>⏰ เวลา:</strong><br>
            ${new Date().toLocaleString('th-TH')}
          </div>
        </div>
      </div>

      <div class="search-box">
        <input type="text" id="searchInput" placeholder="🔍 ค้นหาในโค้ด..." onkeyup="searchInCode()">
      </div>

      <div class="controls">
        <button onclick="copyCode()" class="btn">
          📋 คัดลอกโค้ด
        </button>
        <button onclick="downloadCode()" class="btn btn-secondary">
          💾 ดาวน์โหลด
        </button>
        <button onclick="beautifyCode()" class="btn btn-secondary">
          ✨ จัดรูปแบบ
        </button>
        <button onclick="toggleWrap()" class="btn btn-secondary">
          📝 สลับ Wrap
        </button>
        <a href="/" class="btn btn-secondary">
          🔙 กลับหน้าแรก
        </a>
      </div>

      <div class="code-container">
        <div class="code-header">
          <span>📜 Source Code</span>
          <div class="code-stats">
            <span id="selectedText"></span>
          </div>
        </div>
        <pre id="source-code">${escapedCode}</pre>
      </div>

      <script>
        let isWrapped = true;

        function copyCode() {
          const code = document.getElementById('source-code').textContent;
          
          if (navigator.clipboard) {
            navigator.clipboard.writeText(code).then(() => {
              showNotification('✅ คัดลอกโค้ดสำเร็จ!');
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
            showNotification('✅ คัดลอกโค้ดสำเร็จ!');
          } catch (err) {
            showNotification('❌ ไม่สามารถคัดลอกได้');
          }
          document.body.removeChild(textarea);
        }

        function downloadCode() {
          const code = document.getElementById('source-code').textContent;
          const url = '${escapeHtml(url)}';
          const domain = new URL(url).hostname;
          const filename = \`\${domain}_source.html\`;
          
          const blob = new Blob([code], { type: 'text/html;charset=utf-8' });
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(link.href);
          
          showNotification('💾 ดาวน์โหลดสำเร็จ!');
        }

        function beautifyCode() {
          const codeElement = document.getElementById('source-code');
          let code = codeElement.textContent;
          
          // Simple HTML beautification
          try {
            code = code
              .replace(/></g, '>\\n<')
              .replace(/\\n\\s*\\n/g, '\\n')
              .split('\\n')
              .map(line => line.trim())
              .filter(line => line.length > 0)
              .join('\\n');
            
            codeElement.textContent = code;
            showNotification('✨ จัดรูปแบบสำเร็จ!');
          } catch (e) {
            showNotification('❌ ไม่สามารถจัดรูปแบบได้');
          }
        }

        function toggleWrap() {
          const codeElement = document.getElementById('source-code');
          isWrapped = !isWrapped;
          codeElement.style.whiteSpace = isWrapped ? 'pre-wrap' : 'pre';
          showNotification(isWrapped ? '📝 เปิด Text Wrap' : '📏 ปิด Text Wrap');
        }

        function searchInCode() {
          const searchTerm = document.getElementById('searchInput').value.toLowerCase();
          const codeElement = document.getElementById('source-code');
          const code = codeElement.textContent;
          
          if (!searchTerm) {
            codeElement.innerHTML = \`\${escapeHtml(code)}\`;
            return;
          }
          
          const regex = new RegExp(\`(\${searchTerm.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')})\`, 'gi');
          const highlightedCode = escapeHtml(code).replace(regex, '<mark style="background: #ffeb3b; color: #000;">$1</mark>');
          codeElement.innerHTML = highlightedCode;
        }

        function escapeHtml(text) {
          const div = document.createElement('div');
          div.textContent = text;
          return div.innerHTML;
        }

        function showNotification(message) {
          const notification = document.getElementById('notification');
          notification.textContent = message;
          notification.style.display = 'block';
          setTimeout(() => {
            notification.style.display = 'none';
          }, 3000);
        }

        // Track text selection
        document.addEventListener('mouseup', function() {
          const selection = window.getSelection().toString();
          const selectedElement = document.getElementById('selectedText');
          if (selection.length > 0) {
            selectedElement.textContent = \`เลือก: \${selection.length} ตัวอักษร\`;
          } else {
            selectedElement.textContent = '';
          }
        });
      </script>
    </body>
    </html>
  `;
}

// Main route with enhanced fetching
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

  console.log(`🚀 Starting enhanced fetch for: ${url}`);
  const startTime = Date.now();

  try {
    const result = await smartFetch(url);
    
    if (!result.success) {
      throw new Error(result.error);
    }

    const sourceCode = result.data;
    const fetchTime = Date.now() - startTime;
    
    if (typeof sourceCode !== 'string') {
      return res.status(400).send(`
        <h2>❌ ไฟล์ไม่ใช่ text</h2>
        <p>ประเภทไฟล์ที่ได้รับไม่สามารถแสดงเป็น text ได้</p>
        <a href="/">กลับ</a>
      `);
    }

    if (sourceCode.length > 5 * 1024 * 1024) { // 5MB
      return res.status(413).send(`
        <h2>📦 ไฟล์ใหญ่เกินไป</h2>
        <p>ขนาดไฟล์: ${Math.round(sourceCode.length / 1024 / 1024)} MB (สูงสุด 5MB)</p>
        <a href="/">กลับ</a>
      `);
    }

    console.log(`✅ Successfully fetched ${sourceCode.length} bytes in ${fetchTime}ms`);
    
    // Determine which method was used based on content characteristics
    let method = 'axios';
    if (sourceCode.includes('<!DOCTYPE html>') && sourceCode.includes('<script')) {
      method = 'puppeteer';
    }
    
    res.send(generateSuccessPage(url, sourceCode, method));
    
  } catch (error) {
    console.error('❌ Final error:', error.message);
    
    let errorMsg = 'เกิดข้อผิดพลาดในการดึงข้อมูล';
    let suggestions = [];
    
    if (error.message.includes('ENOTFOUND')) {
      errorMsg = 'ไม่พบเว็บไซต์นี้';
      suggestions.push('ตรวจสอบ URL ให้ถูกต้อง');
      suggestions.push('ลองเพิ่ม www. หน้า domain');
    } else if (error.message.includes('ETIMEDOUT')) {
      errorMsg = 'หมดเวลาในการเชื่อมต่อ';
      suggestions.push('เว็บไซต์อาจช้าหรือไม่สามารถเข้าถึงได้');
      suggestions.push('ลองใหม่อีกครั้งในอีกสักครู่');
    } else if (error.message.includes('403')) {
      errorMsg = 'เว็บไซต์ปฏิเสธการเข้าถึง (403)';
      suggestions.push('เว็บไซต์อาจมีการป้องกัน bot');
      suggestions.push('ลองเข้าถึงผ่านเบราว์เซอร์ก่อน');
    } else if (error.message.includes('404')) {
      errorMsg = 'ไม่พบหน้าเว็บนี้ (404)';
      suggestions.push('ตรวจสอบ URL ให้ถูกต้อง');
    } else if (error.message.includes('SSL') || error.message.includes('certificate')) {
      errorMsg = 'ปัญหาใบรับรอง SSL';
      suggestions.push('เว็บไซต์อาจมีปัญหาด้านความปลอดภัย');
    }

    res.status(500).send(`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background: #1a1a1a; color: #e0e0e0; border-radius: 10px;">
        <h2 style="color: #ff6b6b;">❌ ${errorMsg}</h2>
        <div style="background: #2d2d2d; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <strong>🌐 URL:</strong> ${escapeHtml(url)}<br>
          <strong>⚠️ ข้อผิดพลาด:</strong> ${escapeHtml(error.message)}
        </div>
        ${suggestions.length > 0 ? `
          <div style="background: #2d4a2d; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <strong>💡 คำแนะนำ:</strong>
            <ul>
              ${suggestions.map(s => `<li>${s}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
        <div style="text-align: center; margin-top: 30px;">
          <a href="/" style="background: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">🔙 กลับหน้าแรก</a>
        </div>
      </div>
    `);
  }
});

// Enhanced home page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Enhanced Web Source Fetcher</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .container {
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(10px);
          border-radius: 20px;
          padding: 40px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
          max-width: 500px;
          width: 100%;
        }
        h1 { 
          text-align: center; 
          color: #333; 
          margin-bottom: 10px;
          font-size: 28px;
        }
        .subtitle {
          text-align: center;
          color: #666;
          margin-bottom: 30px;
          font-size: 16px;
        }
        .form-group {
          margin-bottom: 20px;
        }
        label {
          display: block;
          margin-bottom: 8px;
          color: #333;
          font-weight: 500;
        }
        input[type="url"] {
          width: 100%;
          padding: 15px;
          border: 2px solid #ddd;
          border-radius: 10px;
          font-size: 16px;
          transition: border-color 0.3s ease;
        }
        input[type="url"]:focus {
          outline: none;
          border-color: #667eea;
        }
        .btn-submit {
          width: 100%;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          padding: 15px;
          border-radius: 10px;
          font-size: 18px;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.3s ease;
        }
        .btn-submit:hover {
          transform: translateY(-2px);
        }
        .features {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #eee;
        }
        .feature-list {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 15px;
          margin-top: 15px;
        }
        .feature-item {
          text-align: center;
          padding: 10px;
          background: #f8f9fa;
          border-radius: 8px;
          font-size: 14px;
          color: #555;
        }
        .loading {
          display: none;
          text-align: center;
          margin-top: 20px;
        }
        .spinner {
          border: 3px solid #f3f3f3;
          border-top: 3px solid #667eea;
          border-radius: 50%;
          width: 30px;
          height: 30px;
          animation: spin 1s linear infinite;
          margin: 0 auto 10px;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @media (max-width: 600px) {
          .container { padding: 20px; }
          h1 { font-size: 24px; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🌐 Enhanced Web Fetcher</h1>
        <p class="subtitle">ดึง Source Code จากเว็บไซต์ใดๆ ได้ทุกเว็บ</p>
        
        <form id="fetchForm" action="/fetch-code" method="POST">
          <div class="form-group">
            <label for="url">🔗 URL เว็บไซต์:</label>
            <input 
              type="url" 
              id="url" 
              name="url" 
              placeholder="https://example.com" 
              required
              autocomplete="url"
            >
          </div>
          
          <button type="submit" class="btn-submit">
            🚀 ดึงข้อมูล
          </button>
          
          <div class="loading" id="loading">
            <div class="spinner"></div>
            <p>กำลังดึงข้อมูล... กรุณารอสักครู่</p>
          </div>
        </form>

        <div class="features">
          <h3 style="text-align: center; color: #333; margin-bottom: 15px;">✨ ฟีเจอร์พิเศษ</h3>
          <div class="feature-list">
            <div class="feature-item">
              <div>🤖</div>
              <div>AI Browser</div>
            </div>
            <div class="feature-item">
              <div>🔄</div>
              <div>Multiple Methods</div>
            </div>
            <div class="feature-item">
              <div>🛡️</div>
              <div>Bypass Protection</div>
            </div>
            <div class="feature-item">
              <div>📱</div>
              <div>Mobile Support</div>
            </div>
            <div class="feature-item">
              <div>🔍</div>
              <div>Smart Search</div>
            </div>
            <div class="feature-item">
              <div>💾</div>
              <div>Download</div>
            </div>
          </div>
        </div>
      </div>

      <script>
        document.getElementById('fetchForm').addEventListener('submit', function(e) {
          const loading = document.getElementById('loading');
          const submitBtn = document.querySelector('.btn-submit');
          
          loading.style.display = 'block';
          submitBtn.disabled = true;
          submitBtn.textContent = 'กำลังดึงข้อมูล...';
        });

        // Auto-format URL
        document.getElementById('url').addEventListener('input', function(e) {
          let url = e.target.value.trim();
          if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
            e.target.value = 'https://' + url;
          }
        });
      </script>
    </body>
    </html>
  `);
});

// Health check with enhanced info
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '2.0.0',
    features: ['axios', 'puppeteer', 'multi-method', 'enhanced-headers'],
    time: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API endpoint for programmatic access
app.post('/api/fetch', simpleRateLimit, async (req, res) => {
  const { url } = req.body;
  
  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ 
      success: false, 
      error: 'Invalid URL provided' 
    });
  }

  try {
    console.log(`🔌 API fetch request for: ${url}`);
    const result = await smartFetch(url);
    
    if (!result.success) {
      throw new Error(result.error);
    }

    res.json({
      success: true,
      url: url,
      content: result.data,
      size: result.data.length,
      lines: result.data.split('\n').length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('API Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      url: url,
      timestamp: new Date().toISOString()
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).send(`
    <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 100px; color: #333;">
      <h2>🔍 ไม่พบหน้า</h2>
      <p>หน้าที่คุณต้องการไม่มีอยู่</p>
      <a href="/" style="color: #4CAF50; text-decoration: none;">กลับหน้าแรก</a>
    </div>
  `);
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).send(`
    <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 100px; color: #333;">
      <h2>💥 เซิร์ฟเวอร์เกิดปัญหา</h2>
      <p>กรุณาลองใหม่อีกครั้ง</p>
      <a href="/" style="color: #4CAF50; text-decoration: none;">กลับ</a>
    </div>
  `);
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Enhanced Web Fetcher Server running at http://localhost:${PORT}`);
  console.log(`📅 Started: ${new Date().toLocaleString('th-TH')}`);
  console.log(`🛠️  Features: Multiple fetch methods, Puppeteer support, Enhanced headers`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  clearInterval(cleanupInterval);
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  clearInterval(cleanupInterval);
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
