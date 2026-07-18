# بوت تصوير المواقع + API

بوت تيلجرام يصور أي موقع سكرين شوت + يوفر API مجانية للمطورين.

## المميزات

- 📸 تصوير أي موقع فوراً
- 📸 تصوير صفحة كاملة (Full Page)
- 🔑 نظام API Keys تلقائي
- 💻 أكواد جاهزة بكل اللغات (Node.js, Python, PHP, Java, cURL, JavaScript)
- 📖 توثيق كامل داخل البوت
- 🗑️ الصور لا تُخزّن (تُحذف فوراً بعد الإرسال)
- ♾ بدون حدود

## طريقة النشر على Render

1. ارفع الملفات على GitHub
2. ادخل Render واختر "New Web Service"
3. اربط الريبو
4. **مهم:** اختر Runtime: Docker (مو Node)
5. أضف Environment Variables:
   - `BOT_TOKEN` = توكن البوت
   - `BASE_URL` = رابط مشروعك على Render (مثل https://screenshot-bot.onrender.com)
   - `PORT` = 3000
   - `PUPPETEER_EXECUTABLE_PATH` = /usr/bin/chromium
6. اضغط Deploy

## الملفات

- `server.js` - السيرفر الرئيسي (بوت + API)
- `Dockerfile` - إعدادات Docker مع Chrome
- `package.json` - التبعيات
- `render.yaml` - إعدادات Render

## API

**الرابط:**
```
GET /api/screenshot?url=https://example.com&key=YOUR_KEY
```

**المعاملات:**
| المعامل | مطلوب | الوصف |
|---------|-------|-------|
| url | ✅ | رابط الموقع |
| key | ✅ | مفتاح API |
| width | ❌ | عرض (افتراضي 1280) |
| height | ❌ | ارتفاع (افتراضي 720) |
| fullPage | ❌ | true/false |
| format | ❌ | png/jpeg |
| quality | ❌ | 1-100 (لـ jpeg) |

**الاستجابة:** الصورة مباشرة
