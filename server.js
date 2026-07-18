const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const puppeteer = require('puppeteer');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '8331453319:AAEGxHtY1eO0RLyHFJKpmdHUcNASDkSNzcs';
const BASE_URL = process.env.BASE_URL || 'https://screnwahm.onrender.com';

// ===== Start Express FIRST (so Render sees the port is open) =====
app.get('/', (req, res) => {
  res.send('Screenshot Bot is running!');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Start listening immediately
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Starting bot...');
  startBot();
});

// ===== Storage =====
const keysFile = 'apikeys.json';
let apiKeys = {};
if (fs.existsSync(keysFile)) {
  try { apiKeys = JSON.parse(fs.readFileSync(keysFile, 'utf8')); } catch(e) {}
}
function saveKeys() {
  fs.writeFileSync(keysFile, JSON.stringify(apiKeys, null, 2));
}
function generateApiKey() {
  return 'ss_' + crypto.randomBytes(16).toString('hex');
}

// ===== Screenshot Function =====
async function takeScreenshot(url, options = {}) {
  const {
    width = 1280,
    height = 720,
    fullPage = false,
    format = 'png',
    quality = 80
  } = options;

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: parseInt(width), height: parseInt(height) });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));

    const screenshotOptions = {
      fullPage: fullPage === true || fullPage === 'true',
      type: format === 'jpeg' ? 'jpeg' : 'png'
    };
    if (format === 'jpeg') {
      screenshotOptions.quality = parseInt(quality);
    }

    const screenshot = await page.screenshot(screenshotOptions);
    await browser.close();
    return screenshot;

  } catch (error) {
    if (browser) await browser.close();
    throw error;
  }
}

// ===== API Endpoint =====
app.get('/api/screenshot', async (req, res) => {
  const { url, key, width, height, fullPage, format, quality } = req.query;

  if (!key) {
    return res.status(401).json({ error: 'مفتاح API مطلوب', hint: 'أضف ?key=YOUR_KEY' });
  }
  if (!apiKeys[key]) {
    return res.status(401).json({ error: 'مفتاح API غير صالح' });
  }
  if (!url) {
    return res.status(400).json({ error: 'الرابط مطلوب', hint: 'أضف ?url=https://example.com' });
  }

  try {
    const screenshot = await takeScreenshot(url, { width, height, fullPage, format, quality });
    apiKeys[key].requests++;
    saveKeys();

    const contentType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    res.set('Content-Type', contentType);
    res.set('Content-Disposition', `inline; filename="screenshot.${format || 'png'}"`);
    res.send(screenshot);

  } catch (error) {
    res.status(500).json({ error: 'فشل التصوير: ' + error.message });
  }
});

// ===== Bot =====
let bot;
let userState = {};

function startBot() {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });

  bot.on('polling_error', (err) => {
    console.error('Polling error:', err.message);
  });

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const mainMenu = [
      [{ text: '📸 تصوير موقع', callback_data: 'cmd_screenshot' }],
      [{ text: '📸 تصوير صفحة كاملة', callback_data: 'cmd_fullpage' }],
      [{ text: '🔑 الحصول على API Key', callback_data: 'cmd_getkey' }],
      [{ text: '📖 طريقة استخدام API', callback_data: 'cmd_docs' }],
      [{ text: '💻 أكواد جاهزة (كل اللغات)', callback_data: 'cmd_codes' }],
      [{ text: '📊 إحصائياتي', callback_data: 'cmd_stats' }],
      [{ text: '❓ كيف أربط API بموقعي', callback_data: 'cmd_integrate' }]
    ];

    bot.sendMessage(chatId,
`🖥 *بوت تصوير المواقع*

أرسل لي أي رابط وأرجع لك سكرين شوت فوراً!

✅ مجاني بالكامل
✅ بدون حدود
✅ API متاحة للمطورين
✅ الصور لا تُخزّن

اختر من القائمة:`, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: mainMenu }
    });
  });

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const action = query.data;
    await bot.answerCallbackQuery(query.id);

    if (action === 'cmd_screenshot') {
      userState[chatId] = 'waiting_url';
      bot.sendMessage(chatId, '📸 أرسل رابط الموقع:\n\nمثال: https://google.com');

    } else if (action === 'cmd_fullpage') {
      userState[chatId] = 'waiting_url_full';
      bot.sendMessage(chatId, '📸 أرسل رابط الموقع (تصوير كامل من فوق لتحت):\n\nمثال: https://google.com');

    } else if (action === 'cmd_getkey') {
      let userKey = Object.keys(apiKeys).find(k => apiKeys[k].userId === chatId);
      if (!userKey) {
        userKey = generateApiKey();
        apiKeys[userKey] = {
          userId: chatId,
          username: query.from.username || 'unknown',
          created: new Date().toISOString(),
          requests: 0
        };
        saveKeys();
      }
      bot.sendMessage(chatId,
`🔑 *مفتاح API الخاص بك:*

\`${userKey}\`

⚠️ لا تشاركه مع أحد.`, { parse_mode: 'Markdown' });

    } else if (action === 'cmd_docs') {
      bot.sendMessage(chatId,
`📖 *توثيق API*

*الرابط:*
\`${BASE_URL}/api/screenshot\`

*المعاملات:*
• \`url\` (مطلوب) - رابط الموقع
• \`key\` (مطلوب) - مفتاح API
• \`width\` - عرض (افتراضي 1280)
• \`height\` - ارتفاع (افتراضي 720)
• \`fullPage\` - true/false
• \`format\` - png أو jpeg
• \`quality\` - 1-100 (لـ jpeg)

*مثال:*
\`${BASE_URL}/api/screenshot?url=https://google.com&key=YOUR_KEY\`

*الاستجابة:* الصورة مباشرة`, { parse_mode: 'Markdown' });

    } else if (action === 'cmd_codes') {
      const langMenu = [
        [{ text: '🟢 Node.js', callback_data: 'code_nodejs' }],
        [{ text: '🐍 Python', callback_data: 'code_python' }],
        [{ text: '🐘 PHP', callback_data: 'code_php' }],
        [{ text: '☕ Java', callback_data: 'code_java' }],
        [{ text: '🦀 cURL', callback_data: 'code_curl' }],
        [{ text: '🌐 JavaScript (متصفح)', callback_data: 'code_browser' }],
        [{ text: '🔙 رجوع', callback_data: 'cmd_back' }]
      ];
      bot.sendMessage(chatId, '💻 اختر اللغة:', {
        reply_markup: { inline_keyboard: langMenu }
      });

    } else if (action === 'code_nodejs') {
      bot.sendMessage(chatId,
`🟢 *Node.js:*

\`\`\`javascript
const axios = require('axios');
const fs = require('fs');

async function screenshot(url) {
  const res = await axios.get('${BASE_URL}/api/screenshot', {
    params: { url, key: 'YOUR_API_KEY', format: 'png' },
    responseType: 'arraybuffer'
  });
  fs.writeFileSync('screenshot.png', res.data);
  console.log('Done!');
}

screenshot('https://google.com');
\`\`\`

📦 \`npm install axios\``, { parse_mode: 'Markdown' });

    } else if (action === 'code_python') {
      bot.sendMessage(chatId,
`🐍 *Python:*

\`\`\`python
import requests

res = requests.get('${BASE_URL}/api/screenshot', params={
    'url': 'https://google.com',
    'key': 'YOUR_API_KEY',
    'format': 'png'
})

with open('screenshot.png', 'wb') as f:
    f.write(res.content)
print('Done!')
\`\`\`

📦 \`pip install requests\``, { parse_mode: 'Markdown' });

    } else if (action === 'code_php') {
      bot.sendMessage(chatId,
`🐘 *PHP:*

\`\`\`php
<?php
$params = http_build_query([
    'url' => 'https://google.com',
    'key' => 'YOUR_API_KEY',
    'format' => 'png'
]);

$image = file_get_contents('${BASE_URL}/api/screenshot?' . $params);
file_put_contents('screenshot.png', $image);
echo 'Done!';
?>
\`\`\``, { parse_mode: 'Markdown' });

    } else if (action === 'code_java') {
      bot.sendMessage(chatId,
`☕ *Java:*

\`\`\`java
import java.net.*;
import java.io.*;

public class Screenshot {
    public static void main(String[] args) throws Exception {
        String url = "${BASE_URL}/api/screenshot?url=https://google.com&key=YOUR_API_KEY&format=png";
        InputStream in = new URL(url).openStream();
        FileOutputStream out = new FileOutputStream("screenshot.png");
        in.transferTo(out);
        in.close(); out.close();
        System.out.println("Done!");
    }
}
\`\`\``, { parse_mode: 'Markdown' });

    } else if (action === 'code_curl') {
      bot.sendMessage(chatId,
`🦀 *cURL:*

\`\`\`bash
curl "${BASE_URL}/api/screenshot?url=https://google.com&key=YOUR_API_KEY&format=png" -o screenshot.png
\`\`\`

*مع كل الخيارات:*
\`\`\`bash
curl "${BASE_URL}/api/screenshot?url=https://google.com&key=YOUR_API_KEY&width=1920&height=1080&fullPage=true&format=jpeg&quality=90" -o screenshot.jpg
\`\`\``, { parse_mode: 'Markdown' });

    } else if (action === 'code_browser') {
      bot.sendMessage(chatId,
`🌐 *JavaScript (متصفح):*

\`\`\`html
<img id="shot" />
<script>
  document.getElementById('shot').src = 
    '${BASE_URL}/api/screenshot?url=https://google.com&key=YOUR_API_KEY';
</script>
\`\`\`

*أو بـ fetch:*
\`\`\`javascript
const res = await fetch('${BASE_URL}/api/screenshot?url=https://google.com&key=YOUR_API_KEY');
const blob = await res.blob();
const link = document.createElement('a');
link.href = URL.createObjectURL(blob);
link.download = 'screenshot.png';
link.click();
\`\`\``, { parse_mode: 'Markdown' });

    } else if (action === 'cmd_stats') {
      let userKey = Object.keys(apiKeys).find(k => apiKeys[k].userId === chatId);
      if (userKey) {
        const data = apiKeys[userKey];
        bot.sendMessage(chatId,
`📊 *إحصائياتك:*

🔑 المفتاح: \`${userKey.substring(0, 15)}...\`
📸 عدد الطلبات: ${data.requests}
📅 التسجيل: ${data.created}
♾ الحد: بلا حدود`, { parse_mode: 'Markdown' });
      } else {
        bot.sendMessage(chatId, '❌ ما عندك مفتاح API. اضغط "الحصول على API Key" أولاً.');
      }

    } else if (action === 'cmd_integrate') {
      bot.sendMessage(chatId,
`❓ *كيف تربط API بموقعك:*

*1.* احصل على مفتاح API من القائمة
*2.* استخدم الرابط:
\`${BASE_URL}/api/screenshot?url=SITE&key=KEY\`
*3.* الاستجابة = الصورة مباشرة

*في HTML:*
\`\`\`html
<img src="${BASE_URL}/api/screenshot?url=https://google.com&key=YOUR_KEY" />
\`\`\`

اضغط "أكواد جاهزة" لأمثلة بكل لغة.`, { parse_mode: 'Markdown' });

    } else if (action === 'cmd_back') {
      bot.sendMessage(chatId, 'اضغط /start للقائمة الرئيسية.');
    }
  });

  // Handle URL messages
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) return;

    const urlRegex = /^(https?:\/\/[^\s]+)$/i;
    if (urlRegex.test(text)) {
      const fullPage = userState[chatId] === 'waiting_url_full';
      userState[chatId] = null;

      try {
        await bot.sendMessage(chatId, '⏳ جاري تصوير الموقع... انتظر ثواني');

        const screenshot = await takeScreenshot(text, { fullPage });
        const filePath = `/tmp/ss_${chatId}_${Date.now()}.png`;
        fs.writeFileSync(filePath, screenshot);

        await bot.sendPhoto(chatId, filePath, {
          caption: `📸 سكرين شوت:\n${text}${fullPage ? '\n(صفحة كاملة)' : ''}`
        });

        // Delete immediately
        fs.unlinkSync(filePath);

      } catch (error) {
        bot.sendMessage(chatId, `❌ خطأ: ${error.message}\n\nتأكد الرابط صحيح ويبدأ بـ https://`);
      }
    }
  });

  console.log('Bot started successfully!');
}

// Keep alive - prevent Render from sleeping
setInterval(() => {
  console.log('Keep alive ping:', new Date().toISOString());
}, 60000);

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err.message);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
});
