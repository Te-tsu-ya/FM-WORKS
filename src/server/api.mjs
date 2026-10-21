import {SqlRepository} from './sql-repository.mjs';
import {createServices,hash} from './runtime-services.mjs';
import {createEngine,appVersion,apiMethods} from '../generated/engine.mjs';
import {definitions,seed} from '../generated/schema-meta.mjs';

const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const RPC_BODY_LIMIT=2*1024*1024;
const oversizedInput=()=>Object.assign(new Error('入力は2MiB以下にしてください。'),{httpStatus:413});
async function readRpcInput(request){
 const declared=request.headers.get('content-length');
 if(declared&&/^\d+$/.test(declared)&&Number(declared)>RPC_BODY_LIMIT){
  void request.body?.cancel().catch(()=>{});
  throw oversizedInput();
 }
 const reader=request.body?.getReader();
 if(!reader)throw Error('JSONの形式が正しくありません。');
 const decoder=new TextDecoder('utf-8',{fatal:true});
 const parts=[];let bytes=0;
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   bytes+=value.byteLength;
   if(bytes>RPC_BODY_LIMIT)throw oversizedInput();
   parts.push(decoder.decode(value,{stream:true}));
  }
  parts.push(decoder.decode());
 }catch(error){
  void reader.cancel().catch(()=>{});
  if(error?.httpStatus===413)throw error;
  throw Error('JSONの形式が正しくありません。');
 }finally{reader.releaseLock();}
 // Never put request snippets (which can include session tokens) in error logs.
 try{return JSON.parse(parts.join(''));}catch{throw Error('JSONの形式が正しくありません。');}
}
export async function handleRpc(request,database,method){
 try{
  const url=new URL(request.url);
  if(request.method!=='POST')return json({error:'POSTを使用してください。'},405);
  const origin=request.headers.get('origin');if(origin&&origin!==url.origin)return json({error:'異なるサイトからは操作できません。'},403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON形式で送信してください。'},415);
  const input=await readRpcInput(request);
  if(!input||typeof input!=='object'||!Array.isArray(input.args)||input.args.length>10)return json({error:'引数が不正です。'},400);
  // Reject unauthenticated, mismatched, and unsupported RPCs before reading 54 tables.
  // The Site account allowlist remains the outer access boundary.
  const visitor=request.headers.get('oai-authenticated-user-id')||'SITES_PRIVATE_SERVICE';
  const token=/\bfmworks_sql=([a-f0-9-]{36})/.exec(request.headers.get('cookie')||'')?.[1]||'';
  const isPublic=method==='getPublicAuthConfig'||method==='login';
  const session=!isPublic&&token?await database.prepare('SELECT employee_id, visitor_id, expires_at FROM site_sessions WHERE token_hash = ?').bind(hash(token)).first():null;
  const valid=!!(session&&session.visitor_id===visitor&&session.expires_at>Date.now());
  if(!isPublic&&(!valid||input.args[0]!==token))return json({error:'AUTH_REQUIRED: ログインし直してください。'},401);
  if(!isPublic&&method!=='logout'&&method!=='resumeSession'&&!apiMethods.includes(method))return json({error:'SITES_MIGRATION_PENDING: この操作はSites版への移行中です。'},501);
  if(method==='logout'){
   await database.prepare('DELETE FROM site_sessions WHERE token_hash = ?').bind(hash(token)).run();
   return json({result:{ok:true}},200,{'Set-Cookie':'fmworks_sql=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
  }
  const repository=new SqlRepository(database,definitions,seed);
  if(method==='getPublicAuthConfig'){
   const demoEmployees=await repository.listDemoEmployees();
   return json({result:{appVersion,needsSetup:false,prototypeMode:true,pinLength:6,demoEmployees,support:{note:'開発版では担当者を選ぶだけで利用できます。'}}});
  }
  await repository.load();
  const services=createServices(repository);
  const engine=createEngine(services,valid?{employeeId:session.employee_id}:null,token);
  if(method==='login'){
   const id=String(input.args[0]||'').toUpperCase();const employee=engine.directory().find(e=>e.employeeId===id);
   if(!employee)return json({error:'架空の担当者を選択してください。'},400);
   const nextToken=crypto.randomUUID(),expires=Date.now()+7*86400000;
   await database.batch([database.prepare('DELETE FROM site_sessions WHERE expires_at <= ? OR token_hash = ?').bind(Date.now(),hash(token)),database.prepare('INSERT INTO site_sessions (token_hash, employee_id, visitor_id, expires_at) VALUES (?, ?, ?, ?)').bind(hash(nextToken),id,visitor,expires)]);
   const loggedIn=createEngine(services,{employeeId:id},nextToken);
   return json({result:{sessionToken:nextToken,remembered:!!input.args[3],mustChangePin:false,initialData:loggedIn.initial()}},200,{'Set-Cookie':'fmworks_sql='+nextToken+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800'+(url.protocol==='https:'?'; Secure':'')});
  }
  if(method==='resumeSession')return json({result:{initialData:engine.initial(),mustChangePin:false}});
  const result=await engine.invoke(method,input.args);
  await repository.commit();
  return json({result:JSON.parse(JSON.stringify(result??null))});
 }catch(error){
  const message=String(error?.message||error);
  const status=error?.httpStatus===413?413:message.includes('AUTH_REQUIRED')?401:message.includes('CONFLICT:')?409:message.includes('SITES_MIGRATION_PENDING')?501:400;
  console.error('FM WORKS SQL request failed:',message.slice(0,300));
  return json({error:message},status);
 }
}
