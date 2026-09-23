#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename=fileURLToPath(import.meta.url), __dirname=path.dirname(__filename);
const args=process.argv.slice(2);
const token=(args[0]||process.env.YEMOT_API_KEY||'').trim();
let publicUrl=(args[1]||process.env.PUBLIC_BASE_URL||'').trim();
const extNumber=(args[2]||'2').trim();

if(!token||!publicUrl){console.error('Usage: node auto_setup_yemot.js <YEMOT_TOKEN> <RENDER_URL> [EXTENSION_NUMBER]');process.exit(1);}
publicUrl=publicUrl.replace(/\/$/,'');if(!publicUrl.startsWith('http'))publicUrl='https://'+publicUrl;
const BASE_URL='https://www.call2all.co.il/ym/api';

async function apiRequest(endpoint,params={}){
  const qs=new URLSearchParams({token,...params});
  const res=await fetch(BASE_URL+'/'+endpoint+'?'+qs);
  const text=await res.text();try{return JSON.parse(text);}catch{return {raw:text};}
}
async function uploadFile(remotePath,localFilePath){
  if(!fs.existsSync(localFilePath))throw new Error('Missing local audio file: '+localFilePath);
  const form=new FormData();form.append('file',new Blob([fs.readFileSync(localFilePath)],{type:'audio/wav'}),path.basename(localFilePath));
  const url=BASE_URL+'/UploadFile?token='+encodeURIComponent(token)+'&path='+encodeURIComponent(remotePath)+'&convertAudio=0';
  const res=await fetch(url,{method:'POST',body:form});const text=await res.text();try{return JSON.parse(text);}catch{return {raw:text};}
}
async function run(){
  console.log('Configuring Yemot extension '+extNumber+' -> '+publicUrl+'/yemot');
  const cfg={type:'api',api_link:publicUrl+'/yemot',api_wait:'yes',api_wait_play:'yes',api_wait_answer_music_on_hold:'yes',api_wait_answer_music_on_hold_different:'M0000',api_timeout:'60',tts_rate:'2',rate:'2'};
  const u=await apiRequest('UpdateExtension',{path:'ivr2:/'+extNumber,...cfg});
  if(u.responseStatus!=='OK')throw new Error('UpdateExtension failed: '+JSON.stringify(u));
  console.log('Extension configured');
  for(const file of ['M0000.wav','M1000.wav']){
    const r=await uploadFile('ivr2:'+extNumber+'/'+file,path.join(__dirname,file));
    if(r.responseStatus!=='OK')throw new Error('Upload failed for '+file+': '+JSON.stringify(r));
    console.log(file+' uploaded');
  }
  console.log('Yemot extension '+extNumber+' is configured.');
}
run().catch(e=>{console.error(e.message);process.exit(1);});
