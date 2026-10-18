(()=>{
 const run=(handlers={})=>new Proxy({}, {get(_target,name){
  if(name==='then')return undefined;
  if(name==='withSuccessHandler')return fn=>run({...handlers,success:fn});
  if(name==='withFailureHandler')return fn=>run({...handlers,failure:fn});
  return (...args)=>{
   fetch('/api/rpc/'+encodeURIComponent(name),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({args})})
    .then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error||'読み込みに失敗しました。');return data.result;})
    .then(result=>handlers.success?.(result)).catch(error=>handlers.failure?.(error));
  };
 }});
 window.FMApi={run:run()};
})();
