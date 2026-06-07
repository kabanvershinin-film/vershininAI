import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const allowedPathParts = [
  `${path.sep}providers${path.sep}`,
  `${path.sep}app${path.sep}api${path.sep}`,
  `${path.sep}scripts${path.sep}guards${path.sep}`,
  `${path.sep}docs${path.sep}`,
  `${path.sep}tests${path.sep}`,
];
const patterns = [
  /\/v1\/images\/generations/,
  /\/v1\/video\/create/,
  /\/replicate\/v1\/models/,
  /\/suno\/submit\/music/,
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist' || entry.name === '.codex-backups') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(js|jsx|mjs|ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const offenders = [];
for (const file of walk(root)) {
  const normalized = path.normalize(file);
  if (allowedPathParts.some((part) => normalized.includes(part))) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const pattern of patterns) {
    if (pattern.test(text)) offenders.push(path.relative(root, file));
  }
}

if (offenders.length > 0) {
  console.error('Direct provider endpoint usage outside adapter/api/tests:\n' + Array.from(new Set(offenders)).join('\n'));
  process.exit(1);
}
