require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const puppeteer = require('puppeteer');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
// استخدام المتغيرات البيئية بدلاً من التوكن الصريح
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const BASE_URL = process.env.BASE_URL || 'https://screnwahm.onrender.com';

if (!BOT_TOKEN || !ADMIN_ID) {
  console.error('❌ خطأ: BOT_TOKEN أو ADMIN_ID غير موجود في ملف .env');
  process.exit(1);
}

// ===== Storage =====
const keysFile = 'apikeys.json';
const dbFile = 'database.json';

let apiKeys = {};
let db = {
  users: [],
  channels: [],
  broadcasts: 0,
  settings: {
    bot_status: 'on',
    maintenance_msg: 'البوت حالياً تحت الصيانة 🛠',
    welcome_msg: 'مرحباً بك في بوت تصوير المواقع! 📸'
  }
};

if (fs.existsSync(keysFile)) {
  try { apiKeys = JSON.parse(fs.readFileSync(keysFile, 'utf8')); } catch(e) {}
}
if (fs.existsSync(dbFile)) {
  try { db = JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch(e) {}
}

function saveKeys() {
  fs.writeFileSync(keysFile, JSON.stringify(apiKeys, null, 2));
}
function saveDb() {
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}
function generateApiKey() {
  return 'ss_' + crypto.randomBytes(16).toString('hex');
}

// ===== Express Server =====
app.get('/', (req, res) => {
  res.send('Bot Server is Running!');
});

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startBot();
});

// ===== Screenshot Function =====
async function takeScreenshot(url, options = {}) {
  const { width = 1280, height = 720, fullPage = false, format = 'png', quality = 80 } = options;
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process', '--no-zygote']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: parseInt(width), height: parseInt(height) });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));
    
    const screenshotOptions = { fullPage: fullPage === true || fullPage === 'true', type: format === 'jpeg' ? 'jpeg' : 'png' };
    if (format === 'jpeg') screenshotOptions.quality = parseInt(quality);
    
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
  if (!key) return res.status(401).json({ error: 'مفتاح API مطلوب', hint: 'أضف ?key=YOUR_KEY' });
  if (!apiKeys[key]) return res.status(401).json({ error: 'مفتاح API غير صالح' });
  if (!url) return res.status(400).json({ error: 'الرابط مطلوب', hint: 'أضف ?url=https://example.com' });
  
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

  async function checkSubscription(chatId, userId) {
    if (userId === ADMIN_ID) return true;
    if (db.channels.length === 0) return true;
    
    let notSubscribed = [];
    for (let channel of db.channels) {
      try {
        const member = await bot.getChatMember(channel, userId);
        if (member.status === 'left' || member.status === 'kicked') {
          notSubscribed.push(channel);
        }
      } catch (e) {
        console.log('Error checking channel:', channel, e.message);
      }
    }
    
    if (notSubscribed.length > 0) {
      let buttons = notSubscribed.map(ch => [{ text: `اشتراك في ${ch}`, url: `https://t.me/${ch.replace('@', '')}` }]);
      buttons.push([{ text: '✅ تحقق من الاشتراك', callback_data: 'check_sub' }]);
      
      bot.sendMessage(chatId, '❌ *عذراً، يجب عليك الاشتراك في قنوات البوت أولاً لاستخدامه:*', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
      return false;
    }
    return true;
  }

  function notifyAdminNewUser(msg) {
    if (!db.users.includes(msg.from.id)) {
      db.users.push(msg.from.id);
      saveDb();
      const userLink = msg.from.username ? `@${msg.from.username}` : `[${msg.from.first_name}](tg://user?id=${msg.from.id})`;
      bot.sendMessage(ADMIN_ID, `🔔 *مستخدم جديد!*\n\nالاسم: ${userLink}\nالايدي: \`${msg.from.id}\`\nالعدد الكلي: ${db.users.length}`, { parse_mode: 'Markdown' });
    }
  }

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    notifyAdminNewUser(msg);
    
    if (db.settings.bot_status === 'off' && chatId !== ADMIN_ID) {
      return bot.sendMessage(chatId, db.settings.maintenance_msg);
    }
    
    if (!(await checkSubscription(chatId, msg.from.id))) return;

    const mainMenu = [
      [{ text: '📸 تصوير موقع', callback_data: 'cmd_screenshot' }, { text: '📸 تصوير صفحة كاملة', callback_data: 'cmd_fullpage' }],
      [{ text: '🔑 الحصول على API Key', callback_data: 'cmd_getkey' }, { text: '📊 إحصائياتي', callback_data: 'cmd_stats' }],
      [{ text: '📖 طريقة استخدام API', callback_data: 'cmd_docs' }],
      [{ text: '💻 أكواد جاهزة (كل اللغات)', callback_data: 'cmd_codes' }, { text: '❓ كيف أربط API بموقعي', callback_data: 'cmd_integrate' }]
    ];

    bot.sendMessage(chatId, `🖥 *${db.settings.welcome_msg}*\n\nأرسل لي أي رابط وأرجع لك سكرين شوت فوراً!\n\n✅ مجاني بالكامل\n✅ بدون حدود\n✅ API متاحة للمطورين\n✅ الصور لا تُخزّن\n\nاختر من القائمة:`, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: mainMenu }
    });
  });

  function sendAdminPanel(chatId) {
    const adminMenu = [
      [{ text: '📊 إحصائيات البوت', callback_data: 'admin_stats' }, { text: '📢 إذاعة رسالة', callback_data: 'admin_broadcast' }],
      [{ text: '➕ إضافة قناة اشتراك', callback_data: 'admin_add_ch' }, { text: '➖ حذف قناة اشتراك', callback_data: 'admin_del_ch' }],
      [{ text: '📋 عرض القنوات', callback_data: 'admin_list_ch' }],
      [{ text: db.settings.bot_status === 'on' ? '🔴 إيقاف البوت' : '🟢 تشغيل البوت', callback_data: 'admin_toggle_bot' }]
    ];
    bot.sendMessage(chatId, '👨‍💻 *لوحة تحكم الإدارة*\n\nمرحباً بك يا مطور، تحكم بالبوت من هنا:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: adminMenu }
    });
  }

  bot.onText(/\/admin/, (msg) => {
    if (msg.chat.id === ADMIN_ID) sendAdminPanel(msg.chat.id);
  });

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const action = query.data;
    await bot.answerCallbackQuery(query.id);

    if (chatId !== ADMIN_ID && !action.startsWith('check_sub') && !action.startsWith('admin_')) {
      if (db.settings.bot_status === 'off') return bot.sendMessage(chatId, db.settings.maintenance_msg);
      if (!(await checkSubscription(chatId, query.from.id))) return;
    }

    if (action === 'check_sub') {
      if (await checkSubscription(chatId, query.from.id)) {
        bot.sendMessage(chatId, '✅ *تم التحقق من الاشتراك بنجاح!*\nاضغط /start للبدء.', { parse_mode: 'Markdown' });
      }
    }

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
        apiKeys[userKey] = { userId: chatId, username: query.from.username || 'unknown', created: new Date().toISOString(), requests: 0 };
        saveKeys();
      }
      bot.sendMessage(chatId, `🔑 *مفتاح API الخاص بك:*\n\n\`${userKey}\`\n\n⚠️ لا تشاركه مع أحد.`, { parse_mode: 'Markdown' });
    } else if (action === 'cmd_docs') {
      bot.sendMessage(chatId, `📖 *توثيق API*\n\n*الرابط:*\n\`${BASE_URL}/api/screenshot\`\n\n*المعاملات:*\n• \`url\` (مطلوب) - رابط الموقع\n• \`key\` (مطلوب) - مفتاح API\n• \`width\` - عرض (افتراضي 1280)\n• \`height\` - ارتفاع (افتراضي 720)\n• \`fullPage\` - true/false\n• \`format\` - png أو jpeg\n• \`quality\` - 1-100 (لـ jpeg)\n\n*مثال:*\n\`${BASE_URL}/api/screenshot?url=https://google.com&key=YOUR_KEY\`\n\n*الاستجابة:* الصورة مباشرة`, { parse_mode: 'Markdown' });
    } else if (action === 'cmd_codes') {
      const langMenu = [
        [{ text: '🟢 Node.js', callback_data: 'code_nodejs' }, { text: '🐍 Python', callback_data: 'code_python' }],
        [{ text: '🐘 PHP', callback_data: 'code_php' }, { text: '☕ Java', callback_data: 'code_java' }],
        [{ text: '🦀 cURL', callback_data: 'code_curl' }, { text: '🌐 JavaScript (متصفح)', callback_data: 'code_browser' }],
        [{ text: '🔙 رجوع', callback_data: 'cmd_back' }]
      ];
      bot.sendMessage(chatId, '💻 اختر اللغة:', { reply_markup: { inline_keyboard: langMenu } });
    } else if (action === 'cmd_stats') {
      let userKey = Object.keys(apiKeys).find(k => apiKeys[k].userId === chatId);
      if (userKey) {
        const data = apiKeys[userKey];
        bot.sendMessage(chatId, `📊 *إحصائياتك:*\n\n🔑 المفتاح: \`${userKey.substring(0, 15)}...\`\n📸 عدد الطلبات: ${data.requests}\n📅 التسجيل: ${data.created}\n♾ الحد: بلا حدود`, { parse_mode: 'Markdown' });
      } else {
        bot.sendMessage(chatId, '❌ ما عندك مفتاح API. اضغط "الحصول على API Key" أولاً.');
      }
    } else if (action === 'cmd_integrate') {
      bot.sendMessage(chatId, `❓ *كيف تربط API بموقعك:*\n\n*1.* احصل على مفتاح API من القائمة\n*2.* استخدم الرابط:\n\`${BASE_URL}/api/screenshot?url=SITE&key=KEY\`\n*3.* الاستجابة = الصورة مباشرة\n\nاضغط "أكواد جاهزة" لأمثلة بكل لغة.`, { parse_mode: 'Markdown' });
    } else if (action === 'cmd_back') {
      bot.sendMessage(chatId, 'اضغط /start للقائمة الرئيسية.');
    }

    if (action.startsWith('code_')) {
      const codes = {
        code_nodejs: `🟢 *Node.js:*\n\n\`\`\`javascript\nconst axios = require('axios');\nconst fs = require('fs');\n\nasync function screenshot(url) {\n  const res = await axios.get('${BASE_URL}/api/screenshot', {\n    params: { url, key: 'YOUR_API_KEY', format: 'png' },\n    responseType: 'arraybuffer'\n  });\n  fs.writeFileSync('screenshot.png', res.data);\n}\nscreenshot('https://google.com');\n\`\`\``,
        code_python: `🐍 *Python:*\n\n\`\`\`python\nimport requests\n\nres = requests.get('${BASE_URL}/api/screenshot', params={'url': 'https://google.com', 'key': 'YOUR_API_KEY', 'format': 'png'})\nwith open('screenshot.png', 'wb') as f:\n    f.write(res.content)\n\`\`\``,
        code_php: `🐘 *PHP:*\n\n\`\`\`php\n<?php\n$params = http_build_query(['url' => 'https://google.com', 'key' => 'YOUR_API_KEY', 'format' => 'png']);\n$image = file_get_contents('${BASE_URL}/api/screenshot?' . $params);\nfile_put_contents('screenshot.png', $image);\n?>\n\`\`\``,
        code_java: `☕ *Java:*\n\n\`\`\`java\nimport java.net.*;\nimport java.io.*;\n\npublic class Screenshot {\n    public static void main(String[] args) throws Exception {\n        String url = "${BASE_URL}/api/screenshot?url=https://google.com&key=YOUR_API_KEY&format=png";\n        InputStream in = new URL(url).openStream();\n        FileOutputStream out = new FileOutputStream("screenshot.png");\n        in.transferTo(out);\n        in.close(); out.close();\n    }\n}\n\`\`\``,
        code_curl: `🦀 *cURL:*\n\n\`\`\`bash\ncurl "${BASE_URL}/api/screenshot?url=https://google.com&key=YOUR_API_KEY&format=png" -o screenshot.png\n\`\`\``,
        code_browser: `🌐 *JavaScript (متصفح):*\n\n\`\`\`html\n<img id="shot" src="${BASE_URL}/api/screenshot?url=https://google.com&key=YOUR_API_KEY" />\n\`\`\``
      };
      if (codes[action]) bot.sendMessage(chatId, codes[action], { parse_mode: 'Markdown' });
    }

    if (chatId === ADMIN_ID) {
      if (action === 'admin_stats') {
        bot.sendMessage(chatId, `📊 *إحصائيات البوت:*\n\n👥 عدد المستخدمين: ${db.users.length}\n🔑 عدد مفاتيح API: ${Object.keys(apiKeys).length}\n📢 القنوات: ${db.channels.length}\n📡 حالة البوت: ${db.settings.bot_status === 'on' ? '✅ يعمل' : '❌ متوقف'}`, { parse_mode: 'Markdown' });
      } else if (action === 'admin_broadcast') {
        userState[chatId] = 'admin_broadcast';
        bot.sendMessage(chatId, '📢 أرسل الرسالة التي تريد إذاعتها للمستخدمين الآن:');
      } else if (action === 'admin_add_ch') {
        userState[chatId] = 'admin_add_ch';
        bot.sendMessage(chatId, '➕ أرسل يوزر القناة (مثال: @channel):');
      } else if (action === 'admin_del_ch') {
        userState[chatId] = 'admin_del_ch';
        bot.sendMessage(chatId, '➖ أرسل يوزر القناة لحذفها (مثال: @channel):');
      } else if (action === 'admin_list_ch') {
        bot.sendMessage(chatId, `📋 *قنوات الاشتراك الإجباري:*\n\n${db.channels.join('\n') || 'لا يوجد قنوات'}`, { parse_mode: 'Markdown' });
      } else if (action === 'admin_toggle_bot') {
        db.settings.bot_status = db.settings.bot_status === 'on' ? 'off' : 'on';
        saveDb();
        sendAdminPanel(chatId);
        bot.sendMessage(chatId, `تم تغيير حالة البوت إلى: ${db.settings.bot_status === 'on' ? '✅ يعمل' : '❌ متوقف'}`);
      }
    }
  });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;

    if (chatId === ADMIN_ID) {
      if (userState[chatId] === 'admin_broadcast') {
        userState[chatId] = null;
        let count = 0;
        bot.sendMessage(chatId, '⏳ جاري الإذاعة...');
        for (let user of db.users) {
          try { await bot.sendMessage(user, text); count++; } catch (e) {}
        }
        bot.sendMessage(chatId, `✅ تمت الإذاعة بنجاح لـ ${count} مستخدم.`);
        return;
      } else if (userState[chatId] === 'admin_add_ch') {
        userState[chatId] = null;
        if (!text.startsWith('@')) return bot.sendMessage(chatId, '❌ اليوزر يجب أن يبدأ بـ @');
        if (!db.channels.includes(text)) { db.channels.push(text); saveDb(); bot.sendMessage(chatId, `✅ تم إضافة القناة ${text} بنجاح.`); }
        return;
      } else if (userState[chatId] === 'admin_del_ch') {
        userState[chatId] = null;
        if (db.channels.includes(text)) { db.channels = db.channels.filter(c => c !== text); saveDb(); bot.sendMessage(chatId, `✅ تم حذف القناة ${text} بنجاح.`); }
        return;
      }
    }

    const urlRegex = /^(https?:\/\/[^\s]+)$/i;
    if (urlRegex.test(text)) {
      if (db.settings.bot_status === 'off' && chatId !== ADMIN_ID) return bot.sendMessage(chatId, db.settings.maintenance_msg);
      if (!(await checkSubscription(chatId, msg.from.id))) return;
      const fullPage = userState[chatId] === 'waiting_url_full';
      userState[chatId] = null;
      try {
        const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري تصوير الموقع... انتظر ثواني');
        const screenshot = await takeScreenshot(text, { fullPage });
        const filePath = `/tmp/ss_${chatId}_${Date.now()}.png`;
        fs.writeFileSync(filePath, screenshot);
        await bot.sendPhoto(chatId, filePath, { caption: `📸 سكرين شوت:\n${text}${fullPage ? '\n(صفحة كاملة)' : ''}` });
        fs.unlinkSync(filePath);
        bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
      } catch (error) { bot.sendMessage(chatId, `❌ خطأ: ${error.message}`); }
    }
  });
  console.log('Bot started successfully!');
}

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err.message));
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err.message));
