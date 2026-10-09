import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const root=process.cwd();
const styles=fs.readFileSync(path.join(root,'src/Styles.html'),'utf8')+
  '\n'+fs.readFileSync(path.join(root,'src/StylesWorkflowV15.html'),'utf8');
const quoteSource=fs.readFileSync(path.join(root,'src/AppQuotes.html'),'utf8')
  .replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
const relatedSource=fs.readFileSync(path.join(root,'src/AppDocuments.html'),'utf8')
  .replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
const sampleQuote={id:'QU-FAKE',status:'発行済',number:'FI-0001-0002',
  vendorCode:'FI-0001',vendorName:'架空DX株式会社',subject:'業務システム開発',
  note:'架空データでの画面検証です。',total:550000,quoteDate:'2026-10-10'};
const sampleVendor={code:'FI-0001',name:'架空DX株式会社',invoice:'',address:'架空市'};

function fragment(kind){
  if(kind==='request')return "<div class='modal-backdrop'></div>"+
    "<section class='modal-card request-modal-card' role='dialog' aria-modal='true'>"+
    "<header class='modal-head request-modal-head'><h2>申請内容を確認</h2><button class='icon-button'>×</button></header>"+
    "<div class='request-form-body'><p>申請内容を確認してから送信してください。</p>"+
    "<label class='field'><span>申請する内容</span><input value='休暇申請の例' readonly></label></div>"+
    "<footer class='modal-actions request-modal-actions'><button class='secondary-button'>戻る</button>"+
    "<button class='primary-button'>確認して申請</button></footer></section>";
  const modal={innerHTML:''};
  const ctx=vm.createContext({console,Date,Math,Number,String,Object,Array,JSON,RegExp,Error,Set,Map,
    state:{sessionToken:'FAKE',data:{today:'2026-10-10',user:{employeeId:'FM9001'}}},
    ensureModal:()=>modal,closeModal(){},showToast(){},
    escapeHtml:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    financeYen:n=>Number(n||0).toLocaleString('ja-JP')+'円'});
  vm.runInContext(quoteSource,ctx,{filename:'AppQuotes.html'});
  vm.runInContext(relatedSource,ctx,{filename:'AppDocuments.html'});
  ctx.__vendor=sampleVendor;ctx.__quote=sampleQuote;
  vm.runInContext('quoteUi.data={canConfigure:true,setupRequired:false,documentsSetupRequired:false,'+
    'vendors:[__vendor],quotes:[__quote],relatedDocs:[],sequencesReady:["FI-0001"]};'+
    'quoteUi.editor={id:"QU-FAKE",dirty:false,revision:1,vendorCode:"FI-0001",lines:[]};'+
    'quoteUi.busy=false;quoteUi.dirty=false;quoteUi.mode="edit";',ctx);
  const invocation={
    discard:'quoteConfirmDiscard()',
    issue:'quoteIssue()',
    vendor:'quoteQuickVendorDialog_()',
    receipt:"documentCreateFromQuote('receipt','QU-FAKE')"
  }[kind];
  if(!invocation)throw Error('Unknown test kind: '+kind);
  vm.runInContext(invocation,ctx);
  if(!modal.innerHTML.includes("class='modal-card"))throw Error('No real modal markup generated for '+kind);
  return modal.innerHTML;
}

function rgb(str){
  const m=String(str).match(/rgba?\(([^)]+)\)/i);
  if(!m)return null;
  const nums=m[1].split(/[\s,\/]+/).map(Number).filter(Number.isFinite);
  return nums.length>=3?nums.slice(0,3):null;
}
function luminance(color){
  const nums=rgb(color);if(!nums)return NaN;
  const c=nums.map(v=>{const x=v/255;return x<=0.04045?x/12.92:((x+.055)/1.055)**2.4;});
  return .2126*c[0]+.7152*c[1]+.0722*c[2];
}
function contrastRatio(a,b){
  const la=luminance(a),lb=luminance(b);
  return (Math.max(la,lb)+.05)/(Math.min(la,lb)+.05);
}
function colorDistance(a,b){
  const ra=rgb(a),rb=rgb(b);if(!ra||!rb)return Infinity;
  return Math.max(...ra.map((v,i)=>Math.abs(v-rb[i])));
}
let chrome='';
for(const name of ['google-chrome','google-chrome-stable','chromium']){
  try{chrome=execFileSync('which',[name],{encoding:'utf8'}).trim();if(chrome)break;}catch(_){}
}
if(!chrome)throw Error('Chromium is required for modal theme contrast QA');

const target=path.join(root,'artifacts','modal-theme');
fs.mkdirSync(target,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fmworks-modal-theme-'));
const measure=[
 '<script>(function(){',
 'const modal=document.querySelector(".modal-card"),s=window.getComputedStyle;',
 'get=(sel)=>modal.querySelector(sel),paint=(el)=>el?{color:s(el).color,bg:s(el).backgroundColor}:null,',
 'rect=modal.getBoundingClientRect(),',
 'm={width:innerWidth,height:innerHeight,modal:paint(modal),',
 'heading:paint(get(".modal-head h2")),body:paint(get("p")),',
 'close:paint(get(".modal-head .icon-button")),',
 'secondary:paint(get(".secondary-button")),',
 'label:paint(get(".doc-modal-field, .field > span, .doc-payment-confirm")),',
 'input:paint(get("input:not([type=checkbox])")),',
 'footer:paint(get(".request-modal-actions")),',
 'rect:{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height}};',
 'parent.postMessage({kind:"FM_MODAL_QA",metrics:m},"*");',
 '})();</script>'
].join('');
let total=0,bad=0;
for(const kind of ['discard','issue','vendor','receipt','request']){
  const markup=fragment(kind);
  for(const theme of ['light','dark']){
    for(const [width,height] of [[1366,768],[390,844]]){
      total++;
      const label=kind+'-'+theme+'-'+width+'x'+height;
      const content='<!doctype html><html lang="ja" data-theme="'+theme+'"><head><meta charset="utf-8">'+styles+
        '</head><body><div class="app-shell"><aside class="sidebar"></aside>'+
        '<div class="workspace"><main class="content"><p>ダイアログ背景</p></main></div></div>'+
        '<div id="modalRoot">'+markup+'</div>'+measure+'</body></html>';
      const inner=path.join(temp,label+'-inner.html');fs.writeFileSync(inner,content);
      const listener='<script>window.addEventListener("message",function(e){'+
        'if(e.data&&e.data.kind==="FM_MODAL_QA")'+
        'document.getElementById("qaMetrics").setAttribute("data-metrics",encodeURIComponent(JSON.stringify(e.data.metrics)));'+
        '});</script>';
      const outer='<!doctype html><html><head><meta charset="utf-8">'+listener+
        '</head><body style="margin:0"><iframe src="'+pathToFileURL(inner).href+
        '" style="display:block;border:0;width:'+width+'px;height:'+height+'px"></iframe>'+
        '<output id="qaMetrics"></output></body></html>';
      const host=path.join(temp,label+'-host.html');fs.writeFileSync(host,outer);
      const args=['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage',
        '--disable-extensions','--hide-scrollbars','--window-size='+Math.max(width,600)+','+(height+120),
        '--virtual-time-budget=3000'];
      try{
        const result=execFileSync(chrome,[...args,'--dump-dom',pathToFileURL(host).href],
          {encoding:'utf8',timeout:45000,maxBuffer:6*1024*1024,stdio:['ignore','pipe','ignore']});
        const match=result.match(/id="qaMetrics"[^>]*data-metrics="([^"]+)"/);
        if(!match)throw Error('Browser did not return computed modal styles');
        const m=JSON.parse(decodeURIComponent(match[1])),issues=[];
        if(!m.modal||!m.heading||!m.body)issues.push('missing semantic modal content');
        else {
          if(contrastRatio(m.heading.color,m.modal.bg)<4.5)issues.push('heading contrast');
          if(contrastRatio(m.body.color,m.modal.bg)<4.5)issues.push('body contrast');
          if(theme==='dark'&&luminance(m.modal.bg)>.12)issues.push('dark modal has a light surface');
          if(theme==='light'&&luminance(m.modal.bg)<.72)issues.push('light modal has a dark surface');
        }
        if(m.close&&contrastRatio(m.close.color,m.modal.bg)<4.5)issues.push('close control contrast');
        if(m.secondary&&contrastRatio(m.secondary.color,m.secondary.bg)<4.5)issues.push('secondary control contrast');
        if(m.label&&contrastRatio(m.label.color,m.modal.bg)<4.5)issues.push('field label contrast');
        if(m.input&&contrastRatio(m.input.color,m.input.bg)<4.5)issues.push('input contrast');
        if(m.footer&&colorDistance(m.footer.bg,m.modal.bg)>24)issues.push('sticky footer conflicts with modal theme');
        if(m.rect.left< -2||m.rect.top< -2||m.rect.right>width+2||m.rect.bottom>height+2)issues.push('dialog outside viewport');
        if(m.width!==width)issues.push('unexpected viewport width');
        if(issues.length){bad++;console.error('FAIL '+label+' '+issues.join(', ')+' '+JSON.stringify(m));}
        else console.log('PASS '+label+' heading '+contrastRatio(m.heading.color,m.modal.bg).toFixed(2)+':1');
        if((kind==='discard'||kind==='receipt')&&issues.length===0){
          try{execFileSync(chrome,[...args,'--screenshot='+path.join(target,label+'.png'),pathToFileURL(host).href],
            {timeout:45000,stdio:'ignore'});}
          catch(error){console.warn('Screenshot not captured '+label+': '+String(error.message||error));}
        }
      }catch(error){
        bad++;console.error('FAIL '+label+': '+String(error.message||error));
      }
    }
  }
}
console.log('MODAL CONTRAST TESTS: '+(total-bad)+'/'+total+' passed');
if(bad)process.exitCode=1;
