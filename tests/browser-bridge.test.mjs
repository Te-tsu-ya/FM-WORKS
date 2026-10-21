import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code=fs.readFileSync(new URL('../src/browser/bridge.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const harness=(fetchImpl,{toast=true}={})=>{
 const messages=[],errors=[],calls=[];
 const window=toast?{showToast:msg=>messages.push(msg)}:{};
 const context={window,fetch:(...args)=>{calls.push(args);return fetchImpl(...args)},console:{error:(...args)=>errors.push(args)}};
 vm.runInNewContext(code,context);
 return {run:window.FMApi.run,messages,errors,calls};
};

test('RPC returns the result on a valid JSON response',async()=>{
 const h=harness(async()=>({ok:true,status:200,json:async()=>({result:{status:'ok'}})}));
 let result;
 h.run.withSuccessHandler(value=>result=value).getInitialData('SESSION');
 await tick();
 assert.equal(result.status,'ok');
 assert.equal(h.calls[0][0],'/api/rpc/getInitialData');
 assert.equal(h.calls[0][1].credentials,'same-origin');
 assert.deepEqual(h.messages,[]);
});

test('an explicit error handler receives an RPC rejection without duplicate toast',async()=>{
 const h=harness(async()=>({ok:false,status:403,json:async()=>({error:'この操作を行う権限がありません。'})}));
 let failure;
 h.run.withFailureHandler(error=>failure=error).saveWorklog('SESSION');
 await tick();
 assert.match(failure.message,/権限/);
 assert.deepEqual(h.messages,[]);
});

test('an RPC without a failure handler always notifies the user',async()=>{
 const h=harness(async()=>{throw Error('通信が切れました。')});
 h.run.getInitialData('SESSION');
 await tick();
 assert.deepEqual(h.messages,['通信が切れました。']);
});

test('a non-JSON 502 response shows HTTP failure instead of hiding it',async()=>{
 const h=harness(async()=>({ok:false,status:502,json:async()=>{throw SyntaxError('invalid html')}}));
 h.run.getInitialData('SESSION');
 await tick();
 assert.match(h.messages[0],/502/);
 assert.doesNotMatch(h.messages[0],/invalid html/);
});

test('a malformed successful response never appears as success',async()=>{
 const h=harness(async()=>({ok:true,status:200,json:async()=>({incorrect:'response'})}));
 let success=false;
 h.run.withSuccessHandler(()=>{success=true}).getInitialData('SESSION');
 await tick();
 assert.equal(success,false);
 assert.match(h.messages[0],/応答/);
});

test('missing toast service still logs an RPC error',async()=>{
 const h=harness(async()=>{throw Error('offline')},{toast:false});
 h.run.getInitialData('SESSION');
 await tick();
 assert.equal(h.errors.length,1);
 assert.match(h.errors[0][1],/offline/);
});

test('Promise-like and symbol probes do not become RPC requests',()=>{
 const h=harness(async()=>({ok:true,status:200,json:async()=>({result:'ok'})}));
 assert.equal(h.run.then,undefined);
 assert.equal(h.run[Symbol.toStringTag],undefined);
 assert.equal(h.calls.length,0);
});

test('serialization errors use the failure handler before attempting network access',async()=>{
 const h=harness(()=>{throw Error('must not fetch')});
 const payload={};payload.self=payload;let failure;
 assert.doesNotThrow(()=>h.run.withFailureHandler(error=>failure=error).saveWorklog('SESSION',payload));
 await tick();
 assert.match(failure.message,/circular/i);
 assert.equal(h.calls.length,0);
 assert.deepEqual(h.messages,[]);
});

test('synchronous fetch failure is also reported through the default notification',async()=>{
 const h=harness(()=>{throw Error('fetch could not start')});
 assert.doesNotThrow(()=>h.run.getInitialData('SESSION'));
 await tick();
 assert.deepEqual(h.messages,['fetch could not start']);
});
