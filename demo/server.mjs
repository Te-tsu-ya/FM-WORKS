import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {createDemoRuntime} from './runtime.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function demoHtml(){
 let html=fs.readFileSync(path.join(root,'src/Index.html'),'utf8').replace(/<\?!= include_\('([A-Za-z0-9_]+)'\); \?>/g,(_m,n)=>fs.readFileSync(path.join(root,'src',n+'.html'),'utf8'));
 html=html.replace(/<\?= appName \?>/g,'FM WORKS').replace(/<\?= appVersion \?>/g,'説明用');
 if(/<\?(?:=|!=)/.test(html))throw Error('Unresolved GAS template in repository demo');
 const bridge=`<script>
 (()=>{const runner=(handlers={})=>new Proxy({}, {get(_o,name){
 if(name==='withSuccessHandler')return fn=>runner({...handlers,success:fn});
 if(name==='withFailureHandler')return fn=>runner({...handlers,failure:fn});
 return (...args)=>{fetch('/api/'+encodeURIComponent(name),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({args})}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error||'説明用APIでエラーが発生しました');handlers.success?.(data.result);}).catch(error=>handlers.failure?.(error));};
 }});window.google={script:{run:runner(),host:{close(){}}}};
 document.addEventListener('DOMContentLoaded',()=>{sessionStorage.setItem('fmworks.sessionToken','REPO-DEMO');});})();
 </script>`;
 // Override only the isolated demo bootstrap; the production GAS entry point is untouched.
 const bootstrap='<script>getStoredSessionToken=()=>"REPO-DEMO";document.addEventListener("DOMContentLoaded",()=>{const info=document.createElement("div");info.className="repo-demo-notice";info.textContent="CTO説明用 · 全件架空データ · 保存先はこの起動中のメモリー（サーバー再起動で初期化）";document.getElementById("content").before(info);});</script>';
 return html.replace('<head>','<head>'+bridge+'<style>.repo-demo-notice{padding:9px 28px;background:var(--warning-bg);color:var(--warning-ink);font-size:12px;font-weight:700}</style>').replace('</body>',bootstrap+'</body>');
}
export function createDemoServer(){
 const sessions=new Map(),html=demoHtml();
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const host=String(req.headers.host||'').split(':')[0];if(!['127.0.0.1','localhost','[::1]'].includes(host)){res.writeHead(403);res.end('Local demo only');return;}
  if(req.headers.origin){try{const origin=new URL(req.headers.origin);if(origin.host!==req.headers.host)throw Error('Origin mismatch');}catch{res.writeHead(403);res.end('Origin mismatch');return;}}
  if(req.method==='GET'&&(req.url==='/'||req.url==='/index.html')){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
  if(req.method!=='POST'||!/^\/api\/[A-Za-z]+$/.test(req.url||'')){res.writeHead(404);res.end('Not found');return;}
  const match=String(req.headers.cookie||'').match(/(?:^|;\s*)fmDemo=([a-f0-9-]{36})/);let id=match?.[1];
  if(!id||!sessions.has(id)){id=crypto.randomUUID();sessions.set(id,createDemoRuntime());res.setHeader('Set-Cookie','fmDemo='+id+'; HttpOnly; SameSite=Strict; Path=/');}
  try{
   let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>2*1024*1024)throw Error('入力が大きすぎます');}
   const input=JSON.parse(body||'{}');if(!Array.isArray(input.args))throw Error('Invalid arguments');
   const result=sessions.get(id).call(req.url.slice(5),input.args);res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({result}));
  }catch(e){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:String(e.message||e)}));}
 });return server;
}
