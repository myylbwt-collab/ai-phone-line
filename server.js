import express from 'express';
import { YemotRouter, ExitError } from 'yemot-router2';
import { GoogleGenerativeAI } from '@google/generative-ai';

const app=express(); app.use(express.urlencoded({extended:true})); app.use(express.json());
const apiKeys=(process.env.GEMINI_API_KEYS||'').split(',').map(x=>x.trim()).filter(Boolean);
const models=(process.env.GEMINI_MODELS||'gemini-3-flash-preview,gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite').split(',').map(x=>x.trim()).filter(Boolean);
const perModelTimeout=Number(process.env.PER_MODEL_TIMEOUT_MS||20000), requestTimeout=Number(process.env.REQUEST_TIMEOUT_MS||55000), cooldownMs=Number(process.env.MODEL_COOLDOWN_MS||3600000);
const dashboardPassword=(process.env.DASHBOARD_PASSWORD||'1234').trim();
const clients=apiKeys.map(k=>new GoogleGenerativeAI(k)), modelGrid=models.map(m=>clients.map(c=>c.getGenerativeModel({model:m})));
const cooldowns=new Map(), conversations=[], activeCalls=new Map();
const FILTER='כלל סינון תוכן מחייב: אין לספק, לעודד או לפרט תוכן שאינו תואם ערכי צניעות וחינוך. יש להימנע מתוכן מיני או אירוטי, אלימות גרפית, סמים, הימורים ופגיעה עצמית. אם הנושא האסור מרכזי, החזר בדיוק: "היי עצור הקו מסונן ולא ניתן לדבר איתו על תוכן שאינו מתאים לערכי הצניעות והחינוך"';
const INSTRUCTION=[FILTER,process.env.AI_SYSTEM_INSTRUCTION||''].filter(Boolean).join('\n\n');

function timeout(p,ms,label){let id;const t=new Promise((_,rej)=>id=setTimeout(()=>rej(Object.assign(new Error('Timeout: '+label),{status:408})),ms));return Promise.race([p,t]).finally(()=>clearTimeout(id));}
function sanitize(s){return String(s||'').replace(/[\\*#_~\[\]()<>"“”‘’']/g,' ').replace(/[-–—]/g,' ').replace(/\s+/g,' ').trim();}
async function generate(contents){
  if(!clients.length)throw Object.assign(new Error('Gemini is not configured'),{status:400});
  let last;
  for(let mi=0;mi<modelGrid.length;mi++)for(let ki=0;ki<modelGrid[mi].length;ki++){
    const key=models[mi]+':'+ki, until=cooldowns.get(key)||0;if(until>Date.now())continue;
    try{const r=await timeout(modelGrid[mi][ki].generateContent(contents),perModelTimeout,key);cooldowns.delete(key);return r;}
    catch(e){last=e;if(String(e.status||e.message).includes('429')||String(e.message).toLowerCase().includes('quota'))cooldowns.set(key,Date.now()+cooldownMs);}
  } throw last||new Error('No Gemini model available');
}
async function downloadRecording(path){
  const token=(process.env.YEMOT_API_KEY||'').trim();if(!token)throw new Error('YEMOT_API_KEY missing');
  const clean=String(path).startsWith('ivr2:')?path:'ivr2:'+path;
  const url='https://www.call2all.co.il/ym/api/DownloadFile?token='+encodeURIComponent(token)+'&path='+encodeURIComponent(clean);
  const r=await timeout(fetch(url),requestTimeout,'Yemot download');if(!r.ok)throw new Error('DownloadFile HTTP '+r.status);return Buffer.from(await r.arrayBuffer());
}
async function processAudio(buf,history){
  const hist=history.length?'\nהיסטוריית השיחה:\n'+history.map((x,i)=>'סבב '+(i+1)+': מתקשר: '+x.user+' | תשובה: '+x.reply).join('\n'):'';
  const prompt=INSTRUCTION+hist+'\nזוהי הקלטת שמע של שאלה בטלפון. הבן את השמע ואת ההקשר, וענה בשפה שבה המתקשר דיבר. התשובה מיועדת להקראה קולית: קצרה, טבעית, ברורה וללא Markdown. החזר JSON בלבד: {"transcript":"תמלול קצר","reply":"תשובה להקראה"}';
  const r=await generate([{inlineData:{mimeType:process.env.YEMOT_AUDIO_MIME_TYPE||'audio/wav',data:buf.toString('base64')}},{text:prompt}]);
  const raw=r.response.text().trim();
  try{const x=JSON.parse(raw);return {transcript:sanitize(x.transcript||'הקלטה עובדה'),reply:x.reply||''};}catch{return {transcript:'הקלטת קול',reply:raw};}
}
async function callHandler(call){
  const id=String(call?.callId||call?.values?.ApiCallId||Date.now()), phone=String(call?.values?.ApiPhone||call?.req?.query?.ApiPhone||'לא מזוהה');
  activeCalls.set(id,{id,phone,status:'פעילה',startedAt:new Date().toISOString()});const history=[];
  try{let first=true;while(true){
    const prompt=first?'שלום וברוכים הבאים לקו הטלפון האישי עם בינה מלאכותית. אנא אמור את שאלתך אחרי הצפצוף ולסיום ההקלטה הקש סולמית':'אמור שאלה נוספת ולסיום הקש סולמית או כוכבית ליציאה';first=false;
    const record=await call.read([{type:'text',data:sanitize(prompt)}],'record',{min_length:1,no_confirm_menu:true});
    if(!record||record==='None')return call.id_list_message([{type:'text',data:'תודה רבה ולהתראות'}]);
    let buf;try{buf=await downloadRecording(record);}catch(e){await call.id_list_message([{type:'text',data:'תקלה בהורדת ההקלטה נסה שוב'}],{prependToNextAction:true});continue;}
    if(!buf||buf.length<500){await call.id_list_message([{type:'text',data:'לא שמעתי שאלה אנא נסה שוב'}],{prependToNextAction:true});continue;}
    let reply='',transcript='';try{const x=await processAudio(buf,history);reply=x.reply;transcript=x.transcript;}catch(e){reply=e.status===408?'מצטערים לקח יותר מדי זמן לענות נסה שוב':e.status===429?'מצטערים אני עמוס כרגע נסה שוב עוד מעט':'מצטער הייתה תקלה בעיבוד השאלה אפשר לנסות שוב';}
    reply=sanitize(reply)||'מצטער לא הצלחתי לנסח תשובה נסה שוב';history.push({user:transcript,reply});conversations.push({time:new Date().toISOString(),phone,callId:id,user:transcript,gemini:reply});if(conversations.length>1000)conversations.shift();
    await call.id_list_message([{type:'text',data:reply}],{prependToNextAction:true});
  }}finally{activeCalls.delete(id);}
}
const router=YemotRouter({printLog:true,defaults:{removeInvalidChars:true},uncaughtErrorHandler:e=>console.error(e)});
router.all('/yemot',callHandler);app.use('/',router);
app.get('/health',(req,res)=>res.json({ok:true,status:'online',extension:2,models}));
app.post('/api/verify-auth',(req,res)=>req.body?.password===dashboardPassword?res.json({ok:true}):res.status(401).json({ok:false}));
app.get('/api/conversations',(req,res)=>{if((req.headers['x-dashboard-key']||req.query.key)!==dashboardPassword)return res.status(401).json({error:'unauthorized'});res.json({conversations,activeCalls:Array.from(activeCalls.values()),totalMessages:conversations.length,totalCallers:new Set(conversations.map(x=>x.phone)).size,models});});
app.post('/api/test-ai',async(req,res)=>{if((req.headers['x-dashboard-key']||req.query.key)!==dashboardPassword)return res.status(401).json({ok:false});try{const r=await generate([{text:req.body?.prompt||'שלום, בדוק תקינות'}]);res.json({ok:true,response:r.response.text()});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.get('/',(req,res)=>res.type('html').send('<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><title>קו AI</title><style>body{font-family:system-ui;max-width:900px;margin:40px auto;padding:20px}input,button{padding:10px;margin:4px}</style><h1>קו טלפון אישי עם בינה מלאכותית</h1><p>המערכת מחוברת לשלוחה 2.</p><p><a href="/health">בדיקת Health</a></p><input id="p" type="password" placeholder="סיסמה"><button onclick="login()">כניסה</button><pre id="out"></pre><script>let k="";async function login(){let p=document.getElementById("p").value,r=await fetch("/api/verify-auth",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:p})});if(r.ok){k=p;let x=await fetch("/api/conversations",{headers:{"x-dashboard-key":k}});document.getElementById("out").textContent=JSON.stringify(await x.json(),null,2)}else alert("סיסמה שגויה")}</script></html>'));
process.on('unhandledRejection',e=>{if(!(e instanceof ExitError))console.error(e)});
app.listen(process.env.PORT||3000,()=>console.log('AI phone line server listening; extension 2'));
