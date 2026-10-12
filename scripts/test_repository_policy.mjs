import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const policy=fs.readFileSync('AGENTS.md','utf8'),plan=JSON.parse(fs.readFileSync('scripts/local-checks.json','utf8'));
assert.match(policy,/GitHub Actions/);assert.match(policy,/無料枠/);assert.match(policy,/禁止/);
assert.match(policy,/run_local_checks\.mjs/);assert.match(policy,/workflow_dispatch/);
const active='.github/workflows';
assert.equal(fs.existsSync(active)?fs.readdirSync(active).filter(p=>/\.ya?ml$/i.test(p)).length:0,0,'no active Actions workflow may remain');
assert.equal(plan.policy,'GPT_ONLY_NO_GITHUB_ACTIONS');
const all=[...plan.functional,...plan.browser];assert.equal(new Set(all).size,all.length,'checks run once per profile');
for(const command of all){assert.match(command,/^node scripts\/[A-Za-z0-9_/-]+\.mjs$/);assert.ok(fs.existsSync(command.slice(5)),command);}
const runner=fs.readFileSync('scripts/run_local_checks.mjs','utf8');
assert.match(runner,/spawnSync\(process\.execPath/);assert.match(runner,/sourceHashes/);assert.match(runner,/SKIPPED/);
assert.ok(!/gh workflow|workflow_dispatch\s*\(|api\.github\.com/.test(runner),'local verifier must never contact GitHub execution services');
for(const name of ['README.md','docs/SETUP.md','docs/WORK_CONTINUITY_PROTOCOL.md'])assert.ok(fs.readFileSync(name,'utf8').includes('AGENTS.md'),name+' points GPT to the mandatory policy');
console.log('PASS repository policy: no active workflows, mandatory GPT instructions, local executable checks, honest skipped checks and no GitHub job dispatch');
