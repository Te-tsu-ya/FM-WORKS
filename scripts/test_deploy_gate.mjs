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
console.log('PASS: protected existing GAS deployment preflight, linked version verification and fail-closed behavior');