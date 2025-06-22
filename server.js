const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer');
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// Middleware for parsing JSON
app.use(express.json());

// CORS middleware (if needed)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// URL validation
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

// Rate limiting helper (simple in-memory implementation)
const rateLimitMap = new Map();
function checkRateLimit(ip, maxRequests = 10, windowMs = 60000) {
  const now = Date.now();
  const windowStart = now - windowMs;
  
  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, []);
  }
  
  const requests = rateLimitMap.get(ip).filter(time => time > windowStart);
  requests.push(now);
  rateLimitMap.set(ip, requests);
  
  return requests.length <= maxRequests;
}

// ฟังก์ชันดึงข้อมูลด้วย Puppeteer (รองรับ Render และ Docker)
async function fetchWithPuppeteer(url) {
  let browser;
  try {
    const browserOptions = {
      headless: 'new', // Use new headless mode
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
        '--memory-pressure-off'
      ]
    };

    // Try to use system Chrome if available, fallback to bundled Chromium
    if (process.env.CHROME_BIN) {
      browserOptions.executablePath = process.env.CHROME_BIN;
    }

    browser = await puppeteer.launch(browserOptions);
    
    const page = await browser.newPage();
    
    // Set viewport and user agent
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Set additional headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });
    
    // Navigate with better error handling
    await page.goto(url, { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    
    // Wait a bit for dynamic content
    await page.waitForTimeout(2000);
    
    const content = await page.content();
    return content;
  } catch (error) {
    console.error('Puppeteer error:', error.message);
    throw new Error(`Puppeteer failed: ${error.message}`);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error('Error closing browser:', closeError.message);
      }
    }
  }
}

// ฟังก์ชันดึงข้อมูลด้วย axios
async function fetchWithAxios(url) {
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      validateStatus: function (status) {
        return status >= 200 && status < 300;
      }
    });
    return response.data;
  } catch (error) {
    console.error('Axios error:', error.message);
    throw new Error(`Axios failed: ${error.message}`);
  }
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Web Scraper Server is running',
    version: '1.0.0',
    endpoints: [
      'GET /fetch-puppeteer?url=YOUR_URL',
      'GET /fetch-axios?url=YOUR_URL',
      'GET /health'
    ],
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/health', (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      rss: `${Math.round(memUsage.rss / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)} MB`
    }
  });
});

// Puppeteer endpoint with rate limiting
app.get('/fetch-puppeteer', async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  
  // Rate limiting
  if (!checkRateLimit(clientIp, 5, 60000)) { // 5 requests per minute
    return res.status(429).json({ 
      error: 'Rate limit exceeded',
      message: 'Too many requests. Please try again later.'
    });
  }

  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).json({ 
      error: 'Missing url parameter',
      example: '/fetch-puppeteer?url=https://example.com'
    });
  }
  
  if (!isValidUrl(targetUrl)) {
    return res.status(400).json({ 
      error: 'Invalid URL format',
      message: 'URL must start with http:// or https://'
    });
  }
  
  try {
    console.log(`[${new Date().toISOString()}] Fetching with Puppeteer: ${targetUrl}`);
    const startTime = Date.now();
    const html = await fetchWithPuppeteer(targetUrl);
    const duration = Date.now() - startTime;
    
    res.json({
      success: true,
      url: targetUrl,
      method: 'puppeteer',
      contentLength: html.length,
      content: html,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error fetching with Puppeteer:`, err.message);
    res.status(500).json({ 
      error: 'Failed to fetch with Puppeteer',
      message: err.message,
      url: targetUrl
    });
  }
});

// Axios endpoint with rate limiting
app.get('/fetch-axios', async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  
  // Rate limiting
  if (!checkRateLimit(clientIp, 10, 60000)) { // 10 requests per minute
    return res.status(429).json({ 
      error: 'Rate limit exceeded',
      message: 'Too many requests. Please try again later.'
    });
  }

  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).json({ 
      error: 'Missing url parameter',
      example: '/fetch-axios?url=https://example.com'
    });
  }
  
  if (!isValidUrl(targetUrl)) {
    return res.status(400).json({ 
      error: 'Invalid URL format',
      message: 'URL must start with http:// or https://'
    });
  }
  
  try {
    console.log(`[${new Date().toISOString()}] Fetching with Axios: ${targetUrl}`);
    const startTime = Date.now();
    const html = await fetchWithAxios(targetUrl);
    const duration = Date.now() - startTime;
    
    res.json({
      success: true,
      url: targetUrl,
      method: 'axios',
      contentLength: html.length,
      content: html,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error fetching with axios:`, err.message);
    res.status(500).json({ 
      error: 'Failed to fetch with axios',
      message: err.message,
      url: targetUrl
    });
  }
});

// Combo endpoint - tries axios first, falls back to puppeteer
app.get('/fetch', async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  
  if (!checkRateLimit(clientIp, 8, 60000)) {
    return res.status(429).json({ 
      error: 'Rate limit exceeded',
      message: 'Too many requests. Please try again later.'
    });
  }

  const targetUrl = req.query.url;
  const forceMethod = req.query.method; // 'axios' or 'puppeteer'
  
  if (!targetUrl) {
    return res.status(400).json({ 
      error: 'Missing url parameter',
      example: '/fetch?url=https://example.com&method=auto'
    });
  }
  
  if (!isValidUrl(targetUrl)) {
    return res.status(400).json({ 
      error: 'Invalid URL format',
      message: 'URL must start with http:// or https://'
    });
  }

  let method = 'axios';
  let html = null;
  let error = null;
  const startTime = Date.now();

  try {
    if (forceMethod === 'puppeteer') {
      method = 'puppeteer';
      html = await fetchWithPuppeteer(targetUrl);
    } else if (forceMethod === 'axios') {
      method = 'axios';
      html = await fetchWithAxios(targetUrl);
    } else {
      // Try axios first (faster)
      try {
        console.log(`[${new Date().toISOString()}] Trying Axios first: ${targetUrl}`);
        html = await fetchWithAxios(targetUrl);
        method = 'axios';
      } catch (axiosError) {
        console.log(`[${new Date().toISOString()}] Axios failed, trying Puppeteer: ${targetUrl}`);
        html = await fetchWithPuppeteer(targetUrl);
        method = 'puppeteer (fallback)';
      }
    }

    const duration = Date.now() - startTime;
    
    res.json({
      success: true,
      url: targetUrl,
      method: method,
      contentLength: html.length,
      content: html,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`[${new Date().toISOString()}] Both methods failed for: ${targetUrl}`, err.message);
    res.status(500).json({ 
      error: 'Both fetch methods failed',
      message: err.message,
      url: targetUrl,
      duration: `${duration}ms`
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler - ต้องอยู่ท้ายสุด
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    requestedPath: req.path,
    availableEndpoints: [
      'GET / - Server info',
      'GET /health - Health check',
      'GET /fetch-puppeteer?url=YOUR_URL - Fetch with Puppeteer',
      'GET /fetch-axios?url=YOUR_URL - Fetch with Axios',
      'GET /fetch?url=YOUR_URL&method=auto - Smart fetch (tries both)'
    ]
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
  console.log(`${signal} received, shutting down gracefully`);
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
  
  // Force close server after 10 seconds
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});
