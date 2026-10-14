import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const file=fs.readFileSync('src/ProjectAdvanced.gs','utf8');
const start=file.indexOf('function projectAdvancedTaskOptions_('),end=file.indexOf('function projectAdvancedAlerts_(',start);
assert.ok(start>0&&end>start,'task-option function exists');
let reads=0;
const projects=[{projectId:'P1',name:'架空の稼働案件',status:'進行中'},{projectId:'P2',name:'架空の停止案件',status:'停止'}];
const entries={
 plan:[{ownerId:'M',projectId:'P1'}],
 task:[{id:'T1',projectId:'P1',title:'設計',status:'進行中',ownerId:'U'},
       {id:'T2',projectId:'P1',title:'レビュー',status:'進行中',ownerId:'X'},
       {id:'T3',projectId:'P2',title:'停止業務',status:'進行中',ownerId:'U'}]
};
const c=vm.createContext({Array,Map,Set,console,
 projectAdvancedSheet_:()=>({}),
 projectHubStorage_:()=>({ready:true,sheets:{plan:{},task:{}}}),
 projectHubRows_:kind=>entries[kind],
 getProjectsInternal_:()=>{reads++;return projects}
});
vm.runInContext(file.slice(start,end),c);
const own=c.projectAdvancedTaskOptions_({employeeId:'U',role:'USER'},projects);
assert.deepEqual(Array.from(own,x=>x.id),['T1']);assert.equal(reads,0,'known catalog avoids new read');
const managed=c.projectAdvancedTaskOptions_({employeeId:'M',role:'MANAGER'},projects);
assert.deepEqual(Array.from(managed,x=>x.id),['T1','T2']);assert.equal(reads,0);
const admin=c.projectAdvancedTaskOptions_({employeeId:'A',role:'ADMIN'});
assert.deepEqual(Array.from(admin,x=>x.id),['T1','T2']);assert.equal(reads,1,'older caller without catalog still works');
const worklog=fs.readFileSync('src/Worklog.gs','utf8');
assert.match(worklog,/const projects=includeProjects\\?getProjectsInternal_\\(false\\):\\[\\]/);
assert.match(worklog,/projectAdvancedTaskOptions_\\(session.employee,projects\\)/);
console.log('PASS worklog catalog reused, empty fallback supported, original ACL filters kept');
