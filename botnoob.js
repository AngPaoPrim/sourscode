const axios = require('axios');

const TOTAL_BOTS = 800;  // จำนวนบอทพร้อมยิง
const REQUESTS_PER_BOT = 50;  // ยิงพร้อมกันกี่ request ต่อบอทในแต่ละรอบ
const TARGET_URL = 'http://localhost:3000/';

async function hitServer(id) {
  while (true) {
    // สร้าง array ของ promises ยิง request พร้อมกันทีเดียว REQUESTS_PER_BOT ครั้ง
    const promises = [];
    for (let i = 0; i < REQUESTS_PER_BOT; i++) {
      promises.push(
        axios.get(TARGET_URL)
          .then(res => {
            console.log(`บอท ${id}: ${res.status}`);
          })
          .catch(() => {
            console.error(`บอท ${id}: ล้มเหลว`);
          })
      );
    }
    // รอให้ทั้งกลุ่ม request ในรอบนี้เสร็จ (หรือจะไม่รอก็ได้ถ้าต้องการแรงสุด)
    await Promise.all(promises);
  }
}

// สตาร์ทบอททั้งหมด
for (let i = 1; i <= TOTAL_BOTS; i++) {
  hitServer(i);
}
