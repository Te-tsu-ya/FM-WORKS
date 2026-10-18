import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './sql-fixture.mjs';
import {SqlRepository} from '../src/server/sql-repository.mjs';
import {definitions,seed} from '../src/generated/schema-meta.mjs';
test('D1 compound SELECT cap: all 54 tables load without any compound SELECT',async()=>{
 const db=new TestD1({forbidCompound:true});try{
  assert.ok(definitions.length>50);
  assert.throws(()=>db.prepare(Array(51).fill('SELECT 1').join(' UNION ALL ')),/compound SELECT disabled/);
  const repository=await new SqlRepository(db,definitions,seed).load();
  assert.equal(repository.tables.size,definitions.length);
  assert.equal(repository.tables.get('社内文書').rows.length,7);
  assert.equal(repository.tables.get('社員マスタ').rows.length,6);
 }finally{db.close();}
});
