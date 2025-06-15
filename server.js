const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 10000;

// ฟังก์ชันดึงข้อมูลด้วย Puppeteer (รองรับ Render)
async function fetchWithPuppeteer(url) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: puppeteer.executablePath(), // บังคับใช้ Chromium ของ Puppeteer เอง
  });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  const content = await page.content();
  await browser.close();
  return content;
}

// ฟังก์ชันดึงข้อมูลด้วย axios (แบบธรรมดา)
async function fetchWithAxios(url) {
  const response = await axios.get(url);
  return response.data;
}

// ตัวอย่าง route ที่เรียกดึงข้อมูล
app.get('/fetch-puppeteer', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }
  try {
    const html = await fetchWithPuppeteer(targetUrl);
    res.send(html);
  } catch (err) {
    console.error('Error fetching with Puppeteer:', err.message);
    res.status(500).send('Failed to fetch with Puppeteer');
  }
});

app.get('/fetch-axios', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }
  try {
    const html = await fetchWithAxios(targetUrl);
    res.send(html);
  } catch (err) {
    console.error('Error fetching with axios:', err.message);
    res.status(500).send('Failed to fetch with axios');
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
