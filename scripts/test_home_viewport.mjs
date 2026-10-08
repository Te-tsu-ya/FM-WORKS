import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';

// Real Chromium layout regression of a synthetic, offline FM WORKS home.
// No authentication, Apps Script, customer records or network access involved.
const root=process.cwd();
const chrome=['google-chrome','google-chrome-stable','chromium','chromium-browser'].find(bin=>{
  const p=spawnSync(bin,['--version'],{encoding:'utf8'});
  return !p.error&&p.status===0;
});
if(!chrome){console.error('Chrome/Chromium is required to verify actual viewport rendering.');process.exit(1);}
const fixtureFiles=['AppCore','AppHomePortal','AppOperations'];
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const original=read('src/Index.html'),styles=read('src/Styles.html');
const sample=(stress=false)=>({
  today:'2026-10-08',serverTime:'2026-10-08T09:00:00.000Z',
  user:{employeeId:'FM0001',displayName:'青木さん',role:'ADMIN'},
  permissions:{adminConsole:true,requestApprove:true},
  attendance:{state:'off',stateLabel:'勤務外',clockIn:'',clockOut:'',workedMinutes:0,
    history:stress?[
      {time:'09:00',action:'出勤',workLocation:'出社'},
      {time:'12:00',action:'休憩開始',workLocation:'出社'},
      {time:'13:00',action:'休憩終了',workLocation:'出社'}
    ]:[]},
  companyToday:{date:'2026-10-08',type:'通常勤務',name:''},
  month:{workHours:'0時間00分',overtime:'0時間00分',leaveBalance:'未設定',pendingRequests:0},
  tasks:stress?[
    {label:'工数入力',status:'2時間不足',tone:'danger'},
    {label:'勤怠の確認',status:'5件',tone:'warning'},
    {label:'申請の承認',status:'3件',tone:'warning'}
  ]:[
    {label:'工数入力',status:'完了',tone:'info'},
    {label:'勤怠の確認',status:'5件',tone:'warning'},
    {label:'申請の承認',status:'0件',tone:'info'}
  ],
  todaySchedule:stress?Array.from({length:4},(_,i)=>({
    date:'2026-10-08',id:'DEMO_'+i,title:'サンプル会議'+i,start:String(i+9).padStart(2,'0')+':00',
    employeeNames:['サンプル社員'],category:'業務'
  })):[]
});
const bootSource=String.raw`
window.addEventListener('DOMContentLoaded',()=>{
  const marker=document.getElementById('homeTestMetrics');
  try{
    document.documentElement.dataset.theme='light';
    document.body.classList.remove('login-mode');
    document.getElementById('loginShell').hidden=true;
    document.getElementById('app').hidden=false;
    state.sessionToken='OFFLINE_VISUAL_TEST';
    state.data=__FIXTURE__;
    state.workLocation='出社';
    state.homeOverview={loading:false,loaded:true,reloadRequested:false,callbacks:[],error:''};
    const content=document.getElementById('content');
    content.classList.add('one-screen');
    content.innerHTML=homePage();
    const rect=selector=>{
      const item=document.querySelector(selector);
      if(!item)return null;
      const r=item.getBoundingClientRect();
      return {top:Math.round(r.top),bottom:Math.round(r.bottom),
        height:Math.round(r.height),width:Math.round(r.width)};
    };
    const layout=document.querySelector('.home-portal-layout');
    const report={viewport:[innerWidth,innerHeight],
      docWidth:document.documentElement.scrollWidth,
      docHeight:document.documentElement.scrollHeight,
      contentHeight:content.clientHeight,contentScroll:content.scrollHeight,
      layoutScroll:layout?layout.scrollHeight-layout.clientHeight:null,
      regions:{
        hero:rect('.home-portal-top'),
        attendance:rect('.home-portal-attendance'),
        priorities:rect('.home-portal-priorities'),
        schedule:rect('.home-portal-agenda'),
        shortcuts:rect('.home-portal-shortcuts')
      },
      controls:document.querySelectorAll('.home-portal-shortcut').length};
    marker.textContent=btoa(JSON.stringify(report));
  }catch(error){marker.textContent=btoa(JSON.stringify({error:String(error),stack:String(error&&error.stack||'')}));}
});
`;
function htmlFor(data){
  let html=original.replace('<?= appName ?>','FM WORKS UI Visual Test');
  html=html.replace('<head>','<head><meta name="viewport" content="width=device-width,initial-scale=1">');
  html=html.replace("<?!= include_('Styles'); ?>",styles);
  for(const name of ['AppCore','AppHomePortal','AppOperations','AppPeopleMonthly','AppLeaveDemo','AppAdmin','AppShell']){
    const marker="<?!= include_('"+name+"'); ?>";
    html=html.replace(marker,fixtureFiles.includes(name)?read('src/'+name+'.html'):'');
  }
  if(html.includes('<?!='))throw new Error('Template includes were not fully expanded');
  html=html.replace('</body>',"<pre id='homeTestMetrics' style='position:fixed;top:0;left:0;width:0;height:0;overflow:hidden;visibility:hidden'>PENDING</pre>"+
    '<script>'+bootSource.replace('__FIXTURE__',JSON.stringify(data))+'</script></body>');
  return html;
}
const out=path.join(os.tmpdir(),'fmworks-home-chromium');
fs.mkdirSync(out,{recursive:true});
const reportDir=path.join(root,'.qa','home');
fs.mkdirSync(reportDir,{recursive:true});
let failures=0;
for(const [name,w,h,stress,desktop] of [
  ['desktop_1792x850',1792,850,false,true],
  ['desktop_1366x768',1366,768,false,true],
  ['desktop_1440x900',1440,900,true,true],
  ['desktop_stress_1366x768',1366,768,true,true],
  ['tablet_1024x768',1024,768,true,false]
]){
  const filename=path.join(out,name+'.html');
  fs.writeFileSync(filename,htmlFor(sample(stress)));
  const args=['--headless=new','--disable-gpu','--disable-dev-shm-usage','--no-sandbox',
    '--hide-scrollbars','--virtual-time-budget=1400','--window-size='+w+','+(h+87),
    '--dump-dom',new URL('file://'+filename).href];
  const response=spawnSync(chrome,args,{encoding:'utf8',maxBuffer:24*1024*1024,timeout:25000});
  if(response.status!==0){console.error('FAIL',name,'Browser failed:',String(response.stderr||response.error).slice(-1300));failures++;continue;}
  const match=String(response.stdout).match(/<pre id="homeTestMetrics"[^>]*>([^<]*)<\/pre>/);
  if(!match){console.error('FAIL',name,'Browser metrics unavailable',response.stdout.slice(-400));failures++;continue;}
  let result;
  try{result=JSON.parse(Buffer.from(match[1],'base64').toString('utf8'));}
  catch(e){console.error('FAIL',name,'Cannot parse metrics',String(e));failures++;continue;}
  if(result.error){console.error('FAIL',name,'Home runtime error:',result.error,result.stack);failures++;continue;}
  const {viewport,regions,docWidth,docHeight}=result;
  const horizontal=docWidth>viewport[0]+2;
  // Chrome CLI reserves approximately 87px for browser chrome in headless mode.
  // We request h+87, then fail if actual CSS viewport is not the intended size.
  const expectedDesktop=desktop;
  const wrongDesktopViewport=desktop&&(viewport[0]!==w||Math.abs(viewport[1]-h)>3);
  const outside=expectedDesktop?Object.entries(regions).filter(([key,r])=>!r||r.top<0||r.bottom>viewport[1]+2):[];
  const documentOverflow=expectedDesktop&&docHeight>viewport[1]+3;
  const invalid=wrongDesktopViewport||horizontal||outside.length>0||documentOverflow||
    result.controls!==5||Object.values(regions).some(v=>!v);
  if(invalid){failures++;console.error('FAIL',name,
    JSON.stringify({wrongDesktopViewport,h,w,horizontal,documentOverflow,outside:outside.map(x=>x[0]),...result}));}
  else console.log('PASS',name,JSON.stringify({viewport,docHeight,layoutScroll:result.layoutScroll,
    hero:regions.hero,shortcuts:regions.shortcuts}));
  if(name==='desktop_1792x850'){
    spawnSync(chrome,['--headless=new','--disable-gpu','--disable-dev-shm-usage','--no-sandbox',
      '--hide-scrollbars','--virtual-time-budget=1000','--window-size='+w+','+(h+87),
      '--screenshot='+path.join(reportDir,name+'.png'),new URL('file://'+filename).href],
      {encoding:'utf8',timeout:25000,maxBuffer:1024*1024});
  }
}

async function runMobileViewport(name,width,height,stress){
  const filename=path.join(out,name+'.html');
  fs.writeFileSync(filename,htmlFor(sample(stress)));
  const userData=path.join(out,'chrome_'+name+'_'+process.pid);
  fs.mkdirSync(userData,{recursive:true});
  const proc=spawn(chrome,[
    '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--no-first-run','--no-default-browser-check','--remote-allow-origins=*',
    '--remote-debugging-port=0','--user-data-dir='+userData,'about:blank'
  ],{stdio:'ignore'});
  let socket=null;
  try{
    const portFile=path.join(userData,'DevToolsActivePort');
    let port='';
    for(let i=0;i<80;i++){
      if(fs.existsSync(portFile)){
        port=fs.readFileSync(portFile,'utf8').split(/\r?\n/)[0].trim();break;
      }
      await new Promise(r=>setTimeout(r,100));
    }
    if(!port)throw new Error('Chromium remote-debugging endpoint did not start');
    let target=null;
    for(let i=0;i<30;i++){
      try{
        const pages=await (await fetch('http://127.0.0.1:'+port+'/json')).json();
        target=pages.find(p=>p.type==='page'&&p.webSocketDebuggerUrl);
      }catch(_){}
      if(target)break;
      await new Promise(r=>setTimeout(r,120));
    }
    if(!target)throw new Error('Chromium page target not found');
    socket=new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{
      socket.addEventListener('open',resolve,{once:true});
      socket.addEventListener('error',reject,{once:true});
    });
    let serial=0;
    const pending=new Map();
    socket.addEventListener('message',event=>{
      let packet;
      try{packet=JSON.parse(String(event.data));}catch(_){return}
      const item=pending.get(packet.id);
      if(!item)return;
      pending.delete(packet.id);
      if(packet.error)item.reject(new Error(packet.error.message||'DevTools error'));
      else item.resolve(packet.result||{});
    });
    const send=(method,params={})=>new Promise((resolve,reject)=>{
      const id=++serial;pending.set(id,{resolve,reject});
      socket.send(JSON.stringify({id,method,params}));
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride',{
      width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile:true
    });
    await send('Page.navigate',{url:new URL('file://'+filename).href});
    let encoded='';
    for(let i=0;i<45;i++){
      const evaluated=await send('Runtime.evaluate',{
        expression:'document.getElementById("homeTestMetrics")?.textContent || ""',
        returnByValue:true
      });
      encoded=evaluated.result&&evaluated.result.value||'';
      if(encoded&&encoded!=='PENDING')break;
      await new Promise(r=>setTimeout(r,110));
    }
    if(!encoded||encoded==='PENDING')throw new Error('Browser layout measurements did not finish');
    const data=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));
    if(data.error)throw new Error(data.error);
    const [actualWidth,actualHeight]=data.viewport;
    const missing=Object.entries(data.regions).filter(([_,rect])=>!rect).map(([name])=>name);
    const incorrect=actualWidth!==width||actualHeight!==height||
      data.docWidth>width+2||data.controls!==5||missing.length>0;
    if(incorrect){
      failures++;
      console.error('FAIL',name,JSON.stringify({requested:[width,height],missing,...data}));
    }else console.log('PASS',name,JSON.stringify({
      viewport:data.viewport,docWidth:data.docWidth,docHeight:data.docHeight,
      scrollAllowed:true,shortcuts:data.regions.shortcuts
    }));
    const png=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    if(png.data)fs.writeFileSync(path.join(reportDir,name+'.png'),Buffer.from(png.data,'base64'));
  }catch(error){
    failures++;
    console.error('FAIL',name,'Real mobile emulation failed:',String(error&&error.stack||error));
  }finally{
    if(socket)socket.close();
    proc.kill('SIGTERM');
  }
}
for(const [name,width,height,stress] of [
  ['mobile_390x844',390,844,true],
  ['mobile_320x700',320,700,false]
]){
  await runMobileViewport(name,width,height,stress);
}

if(failures){console.error('Home viewport tests failed:',failures);process.exit(1);}
console.log('All offline Chromium home viewport tests passed.');
