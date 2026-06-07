import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const allowed = new Set([
  path.normalize('docs/provider-adapter-layer-execution-plan.md'),
  path.normalize('scripts/guards/no-provider-fallback.mjs'),
  path.normalize('tests/provider-layer/provider-routing.test.mjs'),
]);

const patterns = [
  /fallback\s+to\s+muapi/i,
  /selectedProviderId\s*===\s*['"]memefast['"][\s\S]{0,120}providerId\s*=\s*['"]muapi['"]/i,
  /allowSilentProviderFallback\s*:\s*true/i,
  /unverified.*fallback/i,
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist' || entry.name === '.codex-backups') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(js|jsx|mjs|ts|tsx|md)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const offenders = [];
for (const file of walk(root)) {
  const rel = path.normalize(path.relative(root, file));
  if (allowed.has(rel)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const pattern of patterns) {
    if (pattern.test(text)) offenders.push(`${rel}: ${pattern}`);
  }
}

if (offenders.length > 0) {
  console.error('Forbidden provider fallback patterns found:\n' + offenders.join('\n'));
  process.exit(1);
}

const requestPlanPath = path.join(root, 'packages/studio/src/providers/memefast/request-plan.js');
if (fs.existsSync(requestPlanPath)) {
  const requestPlan = fs.readFileSync(requestPlanPath, 'utf8');
  if (!requestPlan.includes('isMemefastRequestPlanProven')) {
    console.error('MemeFast request-plan must run evidence admission before execution.');
    process.exit(1);
  }
}

const providerConfigPath = path.join(root, 'packages/studio/src/providers/config.js');
if (fs.existsSync(providerConfigPath)) {
  const providerConfig = fs.readFileSync(providerConfigPath, 'utf8');
  if (/selectedProviderId\s*:\s*['"]muapi['"]/.test(providerConfig)) {
    console.error('Default selectedProviderId must not be muapi.');
    process.exit(1);
  }
  if (!/selectedProviderId\s*:\s*['"]memefast['"]/.test(providerConfig)) {
    console.error('Default selectedProviderId must be memefast.');
    process.exit(1);
  }
  if (!/allowSilentProviderFallback\s*:\s*false/.test(providerConfig)) {
    console.error('Silent provider fallback must remain disabled.');
    process.exit(1);
  }
}

const muapiFacadePath = path.join(root, 'packages/studio/src/muapi.js');
if (fs.existsSync(muapiFacadePath)) {
  const muapiFacade = fs.readFileSync(muapiFacadePath, 'utf8');
  if (!/export function uploadFile[\s\S]*?shouldUseProviderLayer\(\)[\s\S]*?\/api\/assets\/upload-intent/.test(muapiFacade)) {
    console.error('uploadFile must route non-MuAPI uploads through the asset upload intent endpoint.');
    process.exit(1);
  }
  if (/shouldUseProviderLayer\(\)[\s\S]{0,900}\/api\/v1\/upload_file/.test(muapiFacade)) {
    console.error('Non-MuAPI upload must not route through MuAPI upload_file.');
    process.exit(1);
  }
}
