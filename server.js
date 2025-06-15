const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 10000;

// URL validation
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

// ฟังก์ชันดึงข้อมูลด้วย Puppeteer (รองรับ Render)
async function fetchWithPuppeteer(url) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process'
      ],
      executablePath: puppeteer.executablePath(),
    });
    
    const page = await browser.newPage();
    
    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const content = await page.content();
    return content;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// ฟังก์ชันดึงข้อมูลด้วย axios
async function fetchWithAxios(url) {
  const response = await axios.get(url, {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
  });
  return response.data;
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Web Scraper Server is running',
    endpoints: [
      'GET /fetch-puppeteer?url=YOUR_URL',
      'GET /fetch-axios?url=YOUR_URL'
    ],
    timestamp: new Date().toISOString() 
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Puppeteer endpoint
app.get('/fetch-puppeteer', async (req, res) => {
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }
  
  if (!isValidUrl(targetUrl)) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }
  
  try {
    console.log('Fetching with Puppeteer:', targetUrl);
    const html = await fetchWithPuppeteer(targetUrl);
    
    res.json({
      success: true,
      url: targetUrl,
      method: 'puppeteer',
      contentLength: html.length,
      content: html,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching with Puppeteer:', err.message);
    res.status(500).json({ 
      error: 'Failed to fetch with Puppeteer',
      message: err.message 
    });
  }
});

// Axios endpoint
app.get('/fetch-axios', async (req, res) => {
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }
  
  if (!isValidUrl(targetUrl)) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }
  
  try {
    console.log('Fetching with Axios:', targetUrl);
    const html = await fetchWithAxios(targetUrl);
    
    res.json({
      success: true,
      url: targetUrl,
      method: 'axios',
      contentLength: html.length,
      content: html,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching with axios:', err.message);
    res.status(500).json({ 
      error: 'Failed to fetch with axios',
      message: err.message 
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler - ต้องอยู่ท้ายสุด
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    availableEndpoints: [
      'GET /',
      'GET /health',
      'GET /fetch-puppeteer?url=YOUR_URL',
      'GET /fetch-axios?url=YOUR_URL'
    ]
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});
