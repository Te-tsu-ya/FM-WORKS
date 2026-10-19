(()=>{
 const run=(handlers={})=>new Proxy({}, {get(_target,name){
  if(name==='then'||typeof name==='symbol')return undefined;
  if(name==='withSuccessHandler')return fn=>run({...handlers,success:fn});
  if(name==='withFailureHandler')return fn=>run({...handlers,failure:fn});
  return (...args)=>{
   fetch('/api/rpc/'+encodeURIComponent(name),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({args})})
    .then(async response=>{
     const data=await response.json().catch(()=>null);
     if(!response.ok)throw Error(data?.error||'通信に失敗しました（HTTP '+response.status+'）。');
     if(!data||!Object.hasOwn(data,'result'))throw Error('サーバーからの応答を確認できませんでした。');
     return data.result;
    })
    .then(result=>handlers.success?.(result))
    .catch(error=>{
     if(typeof handlers.failure==='function')return handlers.failure(error);
     const message=String(error?.message||'通信に失敗しました。');
     if(typeof window.showToast==='function')window.showToast(message);
     else console.error('FM WORKS RPC failed:',message);
    });
  };
 }});
 window.FMApi={run:run()};
})();
