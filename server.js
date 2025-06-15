const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 10000;

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

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
async function fetchWithPuppeteer(url, options = {}) {
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
    
    // Set user agent to avoid bot detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Set viewport
    await page.setViewport({ width: 1280, height: 720 });
    
    const timeout = options.timeout || 30000;
    await page.goto(url, { 
      waitUntil: options.waitUntil || 'domcontentloaded', 
      timeout 
    });
    
    // Wait for additional loading if specified
    if (options.waitFor) {
      await page.waitForTimeout(options.waitFor);
    }
    
    const content = await page.content();
    return content;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// ฟังก์ชันดึงข้อมูลด้วย axios (แบบธรรมดา)
async function fetchWithAxios(url, options = {}) {
  const config = {
    timeout: options.timeout || 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      ...options.headers
    }
  };
  
  const response = await axios.get(url, config);
  return response.data;
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Enhanced Puppeteer endpoint
app.get('/fetch-puppeteer', async (req, res) => {
  const targetUrl = req.query.url;
  const waitFor = parseInt(req.query.waitFor) || 0;
  const timeout = parseInt(req.query.timeout) || 30000;
  const waitUntil = req.query.waitUntil || 'domcontentloaded';
  
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }
  
  if (!isValidUrl(targetUrl)) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }
  
  try {
    const html = await fetchWithPuppeteer(targetUrl, {
      waitFor,
      timeout,
      waitUntil
    });
    
    res.json({
      success: true,
      url: targetUrl,
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

// Enhanced Axios endpoint
app.get('/fetch-axios', async (req, res) => {
  const targetUrl = req.query.url;
  const timeout = parseInt(req.query.timeout) || 15000;
  
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }
  
  if (!isValidUrl(targetUrl)) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }
  
  try {
    const html = await fetchWithAxios(targetUrl, { timeout });
    
    res.json({
      success: true,
      url: targetUrl,
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

// Batch fetching endpoint
app.get('/fetch-batch', async (req, res) => {
  const urls = req.query.urls;
  const method = req.query.method || 'axios'; // 'axios' or 'puppeteer'
  
  if (!urls) {
    return res.status(400).json({ error: 'Missing urls parameter (comma-separated)' });
  }
  
  const urlList = urls.split(',').map(url => url.trim()).filter(url => isValidUrl(url));
  
  if (urlList.length === 0) {
    return res.status(400).json({ error: 'No valid URLs provided' });
  }
  
  if (urlList.length > 5) {
    return res.status(400).json({ error: 'Maximum 5 URLs allowed per batch' });
  }
  
  try {
    const results = await Promise.allSettled(
      urlList.map(async (url) => {
        try {
          const content = method === 'puppeteer' 
            ? await fetchWithPuppeteer(url)
            : await fetchWithAxios(url);
          return { url, success: true, content };
        } catch (error) {
          return { url, success: false, error: error.message };
        }
      })
    );
    
    res.json({
      success: true,
      method,
      results: results.map(result => result.value),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in batch fetch:', err.message);
    res.status(500).json({ 
      error: 'Batch fetch failed',
      message: err.message 
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
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
