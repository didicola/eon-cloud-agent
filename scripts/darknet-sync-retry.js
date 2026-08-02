#!/usr/bin/env node
/* darknet-sync-retry.js — deliver darknet coordination to twin via /sync/memory (D1)
 * Cloudflare Workers free-plan daily request quota resets at 00:00 UTC.
 * This daemon backs off to once/hour normally, but tightens to once/60s around
 * the 00:00 UTC reset so it delivers promptly once quota clears.
 */
import fs from 'fs';
import https from 'https';

const CLOUD = process.env.EON_CLOUD || 'https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev';
const UA = 'eon-cloud-store/1.0';
const LOG = '/tmp/darknet-sync-retry.log';
const BASE = process.env.EON_HOME || '/root/eon-cloud-agent';
const CMD_PATH = process.env.CMD_PATH || BASE + '/commands/ubuntu_1785700000_darknet_deploy.cmd';
const CFG_PATH = process.env.CFG_PATH || BASE + '/darknet/termux-peer.hjson';

function log(s){ const ts='['+new Date().toISOString()+'] '+s; console.log(ts); try{fs.appendFileSync(LOG,ts+'\n');}catch(e){} }
function fetchRaw(urlStr, method, body){
  return new Promise((resolve)=>{
    const u=new URL(urlStr);
    const req=https.request({hostname:u.hostname,port:443,path:u.pathname+u.search,method,
      headers:{'User-Agent':UA,'Content-Type':'application/json'}},(r)=>{
        let d=''; r.on('data',c=>d+=c); r.on('end',()=>resolve({status:r.statusCode,body:d}));
      });
    req.on('error',e=>resolve({status:0,err:String(e)}));
    if(body) req.write(body); req.end();
    setTimeout(()=>resolve({status:0,err:'timeout'}),20000);
  });
}
const memId=(t,k)=>'cfg:'+t+':'+k;
const minsToMidnightUtc = () => {
  const now=new Date();
  const next=new Date(now); next.setUTCHours(24,0,0,0);
  return Math.max(0,(next-now)/60000);
};

async function trySync(){
  if(!fs.existsSync(CMD_PATH)){ log("DONE no-more-cmd "+CMD_PATH); return true; }
  const cmd  = fs.readFileSync(CMD_PATH,'utf8');
  const cfg  = fs.existsSync(CFG_PATH)?fs.readFileSync(CFG_PATH,'utf8'):'(cfg absent)';
  const payload=JSON.stringify({entries:[
    {id:memId('cmd','darknet-deploy'),  title:'config:command',       content:cmd},
    {id:memId('darknet','termux-peer'), title:'config:darknet-termux',content:cfg}
  ]});
  const res=await fetchRaw(CLOUD+'/sync/memory','POST',payload);
  if(res.status>=200 && res.status<400){
    log('DELIVERED status='+res.status+' '+(res.body||'').slice(0,60));
    return true;
  }
  log('STILL-BLOCKED status='+res.status+' '+(res.err||res.body||'').slice(0,60));
  return false;
}

async function main(){
  log('darknet-sync-retry started');
  while(true){
    let done=false;
    try{ done=await trySync(); }catch(e){ log('err '+e); }
    if(done) { log('delivered, exiting'); return; }
    const mins=minsToMidnightUtc();
    const waitMs = mins<=2 ? 60000 : (mins<=30 ? 120000 : 600000); // 1min near reset, 10min otherwise
    log('next attempt in '+(waitMs/1000)+'s (quota resets ~'+mins+'m)');
    await new Promise(r=>setTimeout(r,waitMs));
  }
}
main().catch(e=>log('fatal '+e));