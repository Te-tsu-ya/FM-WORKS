import assert from 'node:assert/strict';
import fs from 'node:fs';
const publisher=fs.readFileSync('FM-WORKS-GAS-PUBLISH.bat','utf8');
const installer=fs.readFileSync('FM-WORKS-GAS-SETUP.bat','utf8');
const bridge=fs.readFileSync('scripts/gas_local_bridge.mjs','utf8');
for(const bat of [publisher,installer]){
  assert.match(bat,/git clone --branch main --single-branch/);
  assert.match(bat,/FM-WORKS-PUBLISHER/);
  assert.match(bat,/git remote get-url origin/);
  assert.match(bat,/git fetch --no-tags origin main/);
  assert.match(bat,/git merge --ff-only origin\/main/);
  assert.match(bat,/FM_WORKS_MANUAL_EXPECTED_SHA/);
  assert.match(bat,/clasp\.cmd/);
  assert.doesNotMatch(bat,/workflow_dispatch|gh workflow|git push .*--force/);
  assert.doesNotMatch(bat,/clasp (?:push|create-deployment|create-script|delete-script)/);
}
assert.ok(publisher.indexOf('--preflight-main')<publisher.indexOf('--deploy-main'));
assert.match(publisher,/choice \/C YN/);
assert.match(publisher,/if errorlevel 2 goto CANCEL/);
assert.match(publisher,/if not exist "\.clasp\.json" goto NEED_SETUP/);
assert.match(installer,/--adopt-baseline-prompt/);
assert.match(bridge,/const requested=useMain\?main:/);
assert.match(bridge,/FM_WORKS_MANUAL_EXPECTED_SHA/);
assert.match(bridge,/pullSnapshot\(path\.join\(sandbox,'immutable'\),cfg\.scriptId,version\)/);
assert.match(bridge,/assertPublishedSnapshot\(expected,deployed\)/);
assert.match(bridge,/assertPublishedSnapshot\(deployed,current\)/);
assert.match(bridge,/const deployed=run\('clasp',\['create-deployment','--deploymentId',KNOWN_DEPLOYMENT_ID,/);
assert.match(fs.readFileSync('AGENTS.md','utf8'),/GitHub Actions/);
console.log('PASS reusable Windows BAT: pinning, main-only, old URL, read-only baseline, no Actions');
