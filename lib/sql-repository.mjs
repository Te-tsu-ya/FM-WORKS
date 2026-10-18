import {SqlTable} from './table-adapter.mjs';

const quote=name=>'"'+name.replaceAll('"','""')+'"';
export class SqlRepository {
 constructor(db,definitions,seed){this.db=db;this.definitions=definitions;this.seed=seed;}
 async initialize(){
  const state=await this.db.prepare('SELECT revision FROM workspace_state WHERE id = 1').first();
  if(state)return;
  const queries=[this.db.prepare('INSERT INTO workspace_state (id, revision, seed_version) VALUES (1, 0, ?)').bind('SYNTHETIC_ONLY_V1')];
  for(const spec of this.definitions){const rows=this.seed[spec.name]||[];if(rows.length)queries.push(this.insertRows(spec,rows));}
  try{await this.db.batch(queries);}catch(error){
   // A concurrent first request may have atomically initialized this database.
   if(!await this.db.prepare('SELECT id FROM workspace_state WHERE id = 1').first())throw error;
  }
 }
 insertRows(spec,rows){
  const columns=spec.columns.map(quote);
  const select=spec.columns.map((_,i)=>"json_extract(value, '$["+i+"]')");
  return this.db.prepare('INSERT INTO '+quote(spec.table)+' (row_no, '+columns.join(', ')+') SELECT CAST(key AS INTEGER) + 1, '+select.join(', ')+' FROM json_each(?)').bind(JSON.stringify(rows));
 }
 async load(){
  await this.initialize();
  // Avoid compound SELECT entirely: hosted D1 limits differ from local SQLite.
  // One atomic batch still returns revision and all tables from one snapshot.
  const queries=this.definitions.map(s=>this.db.prepare("SELECT '"+s.name.replaceAll("'","''")+"' AS domain, row_no, json_array("+s.columns.map(quote).join(', ')+') AS data FROM '+quote(s.table)));
  const [state,...results]=await this.db.batch([this.db.prepare('SELECT revision FROM workspace_state WHERE id = 1'),...queries]);
  const byName=new Map(this.definitions.map(s=>[s.name,[]]));
  for(const result of results)for(const row of result.results||[])byName.get(row.domain).push({position:row.row_no,data:JSON.parse(row.data)});
  this.revision=state.results[0].revision;this.tables=new Map();this.initial=new Map();
  for(const spec of this.definitions){
   const rows=byName.get(spec.name).sort((a,b)=>a.position-b.position).map(x=>x.data);
   this.initial.set(spec.name,JSON.stringify(rows));this.tables.set(spec.name,new SqlTable(spec.name,spec.headers,rows));
  }
  return this;
 }
 getDb(){return {getSheetByName:name=>this.tables.get(name)||null,getSheets:()=>[...this.tables.values()],getId:()=> 'SITES_SQL_ONLY'};}
 async commit(){
  const changed=this.definitions.filter(s=>JSON.stringify(this.tables.get(s.name).rows.slice(1))!==this.initial.get(s.name));
  if(!changed.length)return {changed:0,revision:this.revision};
  const guard=crypto.randomUUID();
  const queries=[this.db.prepare('INSERT INTO transaction_guard (id, expected_revision, actual_revision) VALUES (?, ?, (SELECT revision FROM workspace_state WHERE id = 1))').bind(guard,this.revision)];
  for(const spec of changed){queries.push(this.db.prepare('DELETE FROM '+quote(spec.table)));const rows=this.tables.get(spec.name).rows.slice(1);if(rows.length)queries.push(this.insertRows(spec,rows));}
  queries.push(this.db.prepare('UPDATE workspace_state SET revision = revision + 1 WHERE id = 1'));
  queries.push(this.db.prepare('DELETE FROM transaction_guard WHERE id = ?').bind(guard));
  try{await this.db.batch(queries);}catch(error){
   if(/CHECK|expected_revision|transaction_guard/i.test(String(error)))throw Error('CONFLICT: 別の画面で更新されました。再読み込みしてから保存してください。');
   throw error;
  }
  return {changed:changed.length,revision:this.revision+1};
 }
}
