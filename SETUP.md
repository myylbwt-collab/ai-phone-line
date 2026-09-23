# מדריך הקמה מהיר (גרסה 2.0 משודרגת)

פרויקט זה מגיע מוכן לפריסה.

## פריסה ב-Render
1. חברו את מאגר GitHub ל-Render.
2. צרו Web Service בתוכנית Free.
3. Build: npm install
4. Start: npm start
5. הגדירו את משתני הסביבה:
   GEMINI_API_KEYS
   YEMOT_API_KEY
   DASHBOARD_PASSWORD=1234
   GEMINI_MODELS=gemini-3-flash-preview,gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite
   PER_MODEL_TIMEOUT_MS=20000
   REQUEST_TIMEOUT_MS=55000
   MODEL_COOLDOWN_MS=3600000
   PUBLIC_BASE_URL=<כתובת Render>

## הגדרת ימות
node yemot_setup/auto_setup_yemot.js <טוקן_ימות> <כתובת_השרת_ברנדר> <מספר_שלוחה>

הסקריפט מגדיר את השלוחה ומעלה את M0000.wav ואת M1000.wav.