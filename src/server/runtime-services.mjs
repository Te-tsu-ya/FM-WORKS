import {createHash,randomUUID} from 'node:crypto';
export const hash=value=>createHash('sha256').update(String(value)).digest('hex');
export function createServices(repository){
 const memory=new Map();
 const unavailable=()=>{throw Error('SITES_MIGRATION_PENDING: Googleの外部接続は利用しません。この機能はSites版への移行中です。');};
 const formatDate=(value,zone,pattern)=>{
  const date=new Date(value);
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone||'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));
  const tokens={yyyy:p.year,MM:p.month,dd:p.day,HH:p.hour,mm:p.minute,ss:p.second,SSS:String(date.getMilliseconds()).padStart(3,'0')};
  return pattern.replace(/yyyy|SSS|MM|dd|HH|mm|ss/g,part=>tokens[part]);
 };
 const cache={get:key=>memory.get(key)??null,put:(key,value)=>memory.set(key,value),remove:key=>memory.delete(key),getAll:keys=>Object.fromEntries(keys.filter(k=>memory.has(k)).map(k=>[k,memory.get(k)])),putAll:values=>Object.entries(values).forEach(([k,v])=>memory.set(k,v)),removeAll:keys=>keys.forEach(k=>memory.delete(k))};
 return {
  getDb:()=>repository.getDb(),
  Utilities:{getUuid:randomUUID,formatDate,computeDigest:(_algorithm,text)=>Array.from(createHash('sha256').update(String(text)).digest()),DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF-8'},base64Encode:bytes=>Buffer.from(bytes).toString('base64'),base64Decode:text=>Array.from(Buffer.from(text,'base64'))},
  CacheService:{getScriptCache:()=>cache},
  PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='FM_WORKS_ENVIRONMENT'?'DEVELOPMENT':null,getProperties:()=>({}),setProperty:unavailable})},
  SpreadsheetApp:{flush(){},openById:unavailable,create:unavailable},
  DriveApp:new Proxy({}, {get:()=>unavailable}),UrlFetchApp:{fetch:unavailable},
  LockService:{getScriptLock:()=>({waitLock(){},tryLock:()=>true,releaseLock(){}})},
  Session:{getScriptTimeZone:()=> 'Asia/Tokyo'},ScriptApp:new Proxy({}, {get:()=>unavailable})
 };
}
