import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const c=vm.createContext({console,Map,Set,Date,Object,Math,String,Number,RegExp,Array,JSON});
vm.runInContext(fs.readFileSync('src/Code.gs','utf8'),c);
const source=[
 {employeeId:'U',name:'架空 A',displayName:'A',department:'総務',role:'USER',title:'担当',
  managerId:'M',hireDate:'2020-01-01',leaveBasisDate:'2025-01-01',payrollIncluded:true,shortName:'A'},
 {employeeId:'M',name:'架空 B',displayName:'B',department:'営業',role:'MANAGER',title:'主任',
  managerId:'OTHER',hireDate:'2018-03-01',leaveBasisDate:'2024-03-01',payrollIncluded:true,shortName:'B'}
];
let out=c.employeeDirectoryForViewer_(source,{employeeId:'U',role:'USER'});
assert.equal(out.length,2);
for(const person of out){
 assert.ok(!('hireDate' in person));assert.ok(!('leaveBasisDate' in person));
 assert.ok(!('payrollIncluded' in person));
 assert.equal(person.managerId,'','ordinary staff cannot inspect reporting lines');
}
out=c.employeeDirectoryForViewer_(source,{employeeId:'M',role:'MANAGER'});
assert.equal(out[0].managerId,'M','manager retains direct-report selector');
assert.equal(out[1].managerId,'','manager cannot see unrelated reporting line');
out=c.employeeDirectoryForViewer_(source,{employeeId:'ADMIN',role:'ADMIN'});
assert.equal(out,source,'admin still receives full directory');
assert.ok(fs.readFileSync('src/Code.gs','utf8').includes('employees: params.includeEmployees === false ? [] : employeeDirectoryForViewer_(getEmployees_(),viewer)'));
assert.ok(fs.readFileSync('src/Code.gs','utf8').includes('employeeDirectoryForViewer_(getEmployees_(),employee)'));
console.log('PASS privacy-scoped employee directory: ADMIN, MANAGER and USER');
