import crypto from 'node:crypto';

export const RELEASE_BRANCH = 'deploy/gas-production';
export const KNOWN_DEPLOYMENT_ID = 'AKfycbw7oWIZkrOE-ClTVNeI0Kq4hzsZrYaKSC0CqNVsV4bwpufgBVR5-7MYxVEuj_51A9YgvQ';
export const INITIAL_EXPECTED_VERSION = 192;
export const INITIAL_BASELINE_COMMIT = '067b070d2cf307d0a5aff52d716011238d8b819b';
export const ACCEPTED_SOURCE = /^(?:[A-Za-z0-9_-]+\.(?:gs|html)|appsscript\.json)$/;

// Windows npm global shims are .cmd files, which cannot be spawned as normal executables.
// Run only this fixed, trusted CLI via cmd.exe; never interpolate user-supplied shell syntax.
export function claspInvocation(argv, platform = process.platform, env = process.env) {
  if (!Array.isArray(argv) || argv.length === 0) throw Error('Missing clasp arguments.');
  const args = argv.map(arg => String(arg));
  if (platform !== 'win32') return {command:'clasp', args};
  const quote = arg => {
    if (!/^[A-Za-z0-9 _./:=@+\-]+$/.test(arg)) throw Error('Unsafe clasp command argument.');
    return arg.includes(' ') ? '"' + arg + '"' : arg;
  };
  const line = 'clasp.cmd ' + args.map(quote).join(' ');
  // cmd.exe /S /C strips the outer quote pair. Node must pass it verbatim
  // rather than escaping quotes and turning the line into one command name.
  return {command:env.ComSpec || 'cmd.exe',args:['/d','/s','/c','"' + line + '"'],windowsVerbatimArguments:true};
}

export function checkClaspProject(config) {
  if (!config || !/^[A-Za-z0-9_-]{20,}$/.test(String(config.scriptId || ''))) {
    throw Error('Local .clasp.json must contain the existing Apps Script project Script ID.');
  }
  if (String(config.rootDir || '').replace(/[\\/]+$/, '') !== 'src') {
    throw Error('Local .clasp.json rootDir must be src; refusing to push another folder.');
  }
  return {scriptId: config.scriptId, rootDir: 'src'};
}

export function extractDeployment(listOutput, deploymentId = KNOWN_DEPLOYMENT_ID) {
  const lines = String(listOutput).split(/\r?\n/).filter(x => x.includes(deploymentId));
  if (lines.length !== 1) throw Error('The single expected existing GAS deployment was not found.');
  const version = lines[0].match(/@([0-9]+)(?![0-9])/);
  if (!version) throw Error('Unable to identify immutable @version of existing GAS deployment.');
  return Number(version[1]);
}

export function verifyDeployResult(output, deploymentId = KNOWN_DEPLOYMENT_ID) {
  const lines = String(output).split(/\r?\n/).filter(x => x.includes(deploymentId));
  if (lines.length !== 1) throw Error('clasp did not acknowledge updating exactly the existing deployment ID.');
  const version = lines[0].match(/@([0-9]+)(?![0-9])/);
  if (!version) throw Error('No @version returned by clasp deployment update.');
  return Number(version[1]);
}

export function validateRequestedCommit({mainSha, requestedSha, previouslyPublishedSha}) {
  const valid = x => /^[a-f0-9]{40}$/i.test(String(x || ''));
  if (!valid(mainSha) || !valid(requestedSha)) throw Error('Missing or invalid main/release SHA.');
  if (requestedSha !== mainSha) throw Error('Release pointer is not current main. Refusing to deploy an older snapshot.');
  if (requestedSha === previouslyPublishedSha) return false;
  return true;
}

export function normalizedSource(filename, body) {
  const s = String(body).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trimEnd();
  if (filename === 'appsscript.json') {
    const normalize = obj => Array.isArray(obj) ? obj.map(normalize) : obj && typeof obj === 'object' ? Object.fromEntries(Object.entries(obj).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k, normalize(v)])) : obj;
    return JSON.stringify(normalize(JSON.parse(s)));
  }
  return s;
}

export function contentHashes(files) {
  return Object.fromEntries(Object.entries(files).sort(([a],[b]) => a.localeCompare(b)).map(([file, contents]) => {
    if (!ACCEPTED_SOURCE.test(file)) throw Error('Unsupported Apps Script source: ' + file);
    return [file, crypto.createHash('sha256').update(normalizedSource(file, contents)).digest('hex')];
  }));
}

export function compareInventories(localHash, remoteHash) {
  const unexpected = Object.keys(remoteHash).filter(file => !(file in localHash));
  if (unexpected.length) throw Error('Remote Apps Script contains files absent in GitHub, push would delete: ' + unexpected.join(', '));
  return {newFiles: Object.keys(localHash).filter(file => !(file in remoteHash))};
}

export function assertNoRemoteDrift(previousRemoteHash, nowRemoteHash) {
  if (!previousRemoteHash) return;
  const names = new Set([...Object.keys(previousRemoteHash), ...Object.keys(nowRemoteHash)]);
  const changed = [...names].filter(file => previousRemoteHash[file] !== nowRemoteHash[file]);
  if (changed.length) throw Error('Remote Apps Script changed outside approved publisher: ' + changed.join(', '));
}

export function assertPublishedSnapshot(targetHash, remoteHash) {
  const names = new Set([...Object.keys(targetHash), ...Object.keys(remoteHash)]);
  const changed = [...names].filter(file => targetHash[file] !== remoteHash[file]);
  if (changed.length) throw Error('GAS source differs after push/deploy: ' + changed.join(', '));
}

export function sameSourceSnapshot(a, b) {
  if (!a || !b) return false;
  const aNames=Object.keys(a).sort(), bNames=Object.keys(b).sort();
  return aNames.length===bNames.length && aNames.every((name,i)=>name===bNames[i] && a[name]===b[name]);
}
