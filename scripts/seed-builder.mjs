import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export class MemorySheet {
 constructor(name,header,rows=[]){this.name=name;this.rows=[header.slice(),...structuredClone(rows)];}
 appendRow(row){this.rows.push(row.slice());return this;}
}
export function createDemoRuntime(input=JSON.parse(fs.readFileSync(path.join(root,'db/seeds/fixtures.json'),'utf8'))){
 const seed=structuredClone(input);if(seed.meta.kind!=='SYNTHETIC_ONLY')throw Error('Only synthetic data may initialize the repository demo');
 const sheets=new Map();
 const ctx=vm.createContext({console:{log(){},warn(){},error(){}},Date,Math,Object,Array,String,Number,Map,Set,JSON,RegExp});
 for(const name of fs.readdirSync(path.join(root,'src/domain')).filter(n=>n.endsWith('.js')).sort())vm.runInContext(fs.readFileSync(path.join(root,'src/domain',name),'utf8'),ctx,{filename:name});
 const specs=vm.runInContext('DB_SCHEMA_SPECS',ctx);
 for(const [name,header] of Object.entries(specs))sheets.set(name,new MemorySheet(name,header));
 const baseSheets={'プロジェクト':['ID','案件','顧客','状態','開始','終了','備考','更新者','日時'],'工数':Array.from({length:15},(_,i)=>'工数'+i),'打刻ログ':Array.from({length:12},(_,i)=>'打刻'+i),'予定':Array.from({length:18},(_,i)=>'予定'+i),'会社カレンダー':Array.from({length:8},(_,i)=>'会社日'+i),'月次締め':Array.from({length:7},(_,i)=>'締め'+i)};
 for(const [name,header] of Object.entries(baseSheets))if(!sheets.has(name))sheets.set(name,new MemorySheet(name,header));
 for(const name of [...Object.values(vm.runInContext('DB.sheets',ctx)),'日次勤怠','設定','PIN再発行','セッション'])if(!sheets.has(name))sheets.set(name,new MemorySheet(name,Array.from({length:32},(_,i)=>'項目'+i)));
 const insert=(sheetName,keys,objects)=>{const sh=sheets.get(sheetName);objects.forEach(o=>sh.appendRow(keys.map(k=>o[k]??'')));};
 const finance=vm.runInContext('FINANCE_MODELS',ctx),cfp=vm.runInContext('CFP',ctx),cfa=vm.runInContext('CFA',ctx);
 for(const [k,data] of [['receipt',seed.finance.receipts],['expense',seed.finance.expenses],['travel',seed.finance.travels]])insert(finance[k].sheet,finance[k].keys,data);
 for(const [k,data] of [['account',seed.cashflow.accounts],['tx',seed.cashflow.transactions],['plan',seed.cashflow.plans]])insert(cfp[k].sheet,cfp[k].keys,data);
 insert(cfa.note.sheet,cfa.note.keys,seed.cashflow.notes);
 insert('資金繰り年間',['fiscalYear','openingBalance','monthsJson','revision','updatedAt','editorId','requestKey'],seed.cashflow.years);
 seed.projects.forEach(p=>sheets.get('プロジェクト').appendRow([p.projectId,p.name,p.client,p.status,p.startDate,p.endDate,'開発用の架空案件','','']));
 seed.employees.forEach(e=>{const row=Array(specs['社員マスタ'].length).fill('');Object.assign(row,{0:e.employeeId,1:e.name,2:e.displayName,3:e.department,5:e.role,6:'在籍',7:'09:00',8:'18:00',9:60,10:10,20:'ACTIVE'});sheets.get('社員マスタ').appendRow(row);});
 return {seed,sheets,context:ctx};
}
