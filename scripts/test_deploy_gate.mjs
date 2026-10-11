import assert from 'node:assert/strict';
import fs from 'node:fs';
const ci=fs.readFileSync('.github/workflows/ci.yml','utf8');
const deploy=fs.readFileSync('.github/workflows/deploy.yml','utf8');
const pre=deploy.indexOf('      - name: Validate production deployment preflight');
const push=deploy.indexOf('      - name: Push source to Apps Script');
const release=deploy.indexOf('      - name: Update and verify existing web app deployment');
assert.ok(pre>0&&push>pre&&release>push,'preflight must run before modifying GAS source');
assert.match(deploy,/clasp list-deployments/,'existing deployment must be listed');
assert.match(deploy,/create-deployment --deploymentId/,'must update an existing deployment');
assert.match(deploy,/GITHUB_SHA/,'deployed version must carry the commit SHA');
assert.match(deploy,/FM_WORKS_KNOWN_DEPLOYMENT_ID/,'the previously supplied FM WORKS URL is the fallback target');
assert.match(deploy,/FM_WORKS_DEPLOYMENT_ID:?\b/,'deployment identity must be passed to subsequent steps');
assert.match(deploy,/exit 1/,'invalid deployment must stop the workflow');
assert.ok(!deploy.includes('source was pushed but web app deployment was not updated.'),
 'silent green deployment after source-only push is forbidden');
assert.ok(!deploy.includes('clasp create-deployment\n'),'unbounded new public URLs are forbidden');
assert.match(ci,/node scripts\/test_deploy_gate\.mjs/,'CI must enforce deployment checks');

import os from 'node:os';
import path from 'node:path';
import {mkdtempSync,mkdirSync,writeFileSync,chmodSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

// Execute the real release step with an inert clasp stub so a correct-looking line
// on a different deployment, stale version, or huge listing cannot turn CI green.
const marker='      - name: Update and verify existing web app deployment\n        run: |\n';
assert.equal(deploy.split(marker).length,2,'exactly one production verification step');
const after=deploy.split(marker)[1].split('\n');
const command=[];
for(const line of after){
 if(line.startsWith('          '))command.push(line.slice(10));
 else if(line.trim()==='')continue;
 else break;
}
assert.ok(command.length>15,'release verifier should be substantial');
const dir=mkdtempSync(path.join(os.tmpdir(),'fmworks-release-'));
const id='AKfycb'+'M'.repeat(48),sha='b'.repeat(40);
try{
 const fake=path.join(dir,'clasp');
 writeFileSync(fake,`#!/usr/bin/env bash
if [[ "$1" == "create-deployment" ]]; then
  printf "Deployed %s @174\\n" "\${MOCK_RESPONSE_ID:-$FM_WORKS_DEPLOYMENT_ID}"
elif [[ "$1" == "list-deployments" ]]; then
  printf "%s\\n" "$MOCK_LISTING"
else
  exit 8
fi
`);
 chmodSync(fake,0o755);
 const run=(listing,extra={})=>spawnSync('bash',['-euo','pipefail','-c',command.join('\n')],{
  env:{...process.env,PATH:dir+':'+process.env.PATH,FM_WORKS_DEPLOYMENT_ID:id,
   GITHUB_SHA:sha,MOCK_LISTING:listing,FM_WORKS_VERIFY_DELAY_SECONDS:'0',...extra},
  encoding:'utf8',timeout:20000
 });
 const line='- '+id+' @174 - GitHub '+sha;
 const huge=[line,...Array.from({length:1500},(_,i)=>'- other-'+i+' @42 - stale')].join('\n');
 assert.equal(run(huge).status,0,'large deployment list must not fail under pipefail');
 const stale='- '+id+' @173 - GitHub '+sha;
 assert.notEqual(run(stale).status,0,'a different deployed version must fail');
 assert.notEqual(run('- '+id+' @174 - stale\n- other-id @174 - GitHub '+sha).status,0,
  'commit on another deployment must not verify the target');
 assert.notEqual(run('No deployments found').status,0,'missing target must fail');
 assert.notEqual(run(line,{MOCK_RESPONSE_ID:'incorrect-id'}).status,0,
  'update response from another deployment must fail');
}finally{rmSync(dir,{recursive:true,force:true});}

console.log('PASS: protected existing GAS deployment preflight, linked version verification and fail-closed behavior');