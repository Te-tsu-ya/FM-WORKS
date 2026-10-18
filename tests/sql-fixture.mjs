import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
export class TestD1 {
 constructor({forbidCompound=false}={}){this.forbidCompound=forbidCompound;this.sqlite=new DatabaseSync(':memory:');for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())this.sqlite.exec(fs.readFileSync('drizzle/'+file,'utf8'));}
 prepare(sql){if(this.forbidCompound&&/UNION/i.test(sql))throw Error('compound SELECT disabled');if((sql.match(/UNION ALL/g)||[]).length>=50)throw Error('D1_ERROR: too many terms in compound SELECT');const database=this;return {sql,values:[],bind(...values){this.values=values;return this;},async first(){return database.sqlite.prepare(sql).get(...this.values)||null;},async all(){return {results:database.sqlite.prepare(sql).all(...this.values)};},async run(){const result=database.sqlite.prepare(sql).run(...this.values);return {success:true,meta:{changes:result.changes}};}};}
 async batch(statements){this.sqlite.exec('BEGIN IMMEDIATE');try{const results=[];for(const s of statements){const statement=this.sqlite.prepare(s.sql);if(statement.columns().length)results.push({results:statement.all(...s.values),success:true});else{const r=statement.run(...s.values);results.push({results:[],success:true,meta:{changes:r.changes}});}}this.sqlite.exec('COMMIT');return results;}catch(e){this.sqlite.exec('ROLLBACK');throw e;}}
 close(){this.sqlite.close();}
}
