#!/usr/bin/env node
/* Read-only upstream review. Never writes translations or advances the baseline. */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'upstream/sync.json'), 'utf8'));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const allowed = exp => Object.hasOwn(config.expansions, exp) && !config.ignoredExpansions.includes(exp);

function supported(file) {
  const match = /^page\/factions\/([^/]+)\//.exec(file);
  return file === 'page/factions/general.json' || !!(match && allowed(match[1]));
}

function sanitize(file, data) {
  if (file !== 'page/factions/general.json') return data;
  const result = structuredClone(data);
  const indices = result.expansion.folder.flatMap((exp, i) => allowed(exp) ? [i] : []);
  for (const [key, values] of Object.entries(result.expansion)) {
    if (Array.isArray(values)) result.expansion[key] = indices.map(i => values[i]);
  }
  return result;
}

function localPath(upstreamPath) {
  const p = upstreamPath.split('/');
  const exp = p[2];
  if (!allowed(exp)) return null;
  p[2] = config.expansions[exp];
  p[3] = config.factions[exp + '/' + p[3]] || p[3];
  const aliases = config.filenames[exp + '/' + p[4]] || {};
  p[5] = aliases[p[5]] || p[5];
  return p.join('/');
}

function cards(snapshot) {
  const result = {};
  const defaults = snapshot.documents['page/factions/general.json'].filenames;
  for (const [file, data] of Object.entries(snapshot.documents)) {
    if (!supported(file) || !file.endsWith('/text.json')) continue;
    const base = file.slice(0, -'text.json'.length);
    const manifest = { ...defaults, ...data.filenames };
    for (const [category, field] of [['combat', 'combatText'], ['orders', 'ordersText'], ['events', 'eventsText']]) {
      if (category === 'combat') {
        (manifest.combat || []).forEach((files, tier) => files.forEach((name, index) => {
          if (data[field]?.[tier]?.[index]) result[base + category + '/' + name] = data[field][tier][index];
        }));
      } else {
        (manifest[category] || []).forEach((name, index) => {
          if (data[field]?.[index]) result[base + category + '/' + name] = data[field][index];
        });
      }
    }
  }
  return result;
}

function compareSnapshots(before, after) {
  const oldCards = cards(before), newCards = cards(after);
  const changes = [];
  for (const file of [...new Set([...Object.keys(oldCards), ...Object.keys(newCards)])].sort()) {
    const oldCard = oldCards[file] || {}, newCard = newCards[file] || {};
    for (const field of [...new Set([...Object.keys(oldCard), ...Object.keys(newCard)])]) {
      if (JSON.stringify(oldCard[field]) !== JSON.stringify(newCard[field])) {
        changes.push({ file, local: localPath(file), title: newCard.title || oldCard.title, field, before: oldCard[field] ?? null, after: newCard[field] ?? null });
      }
    }
  }
  const assets = [...new Set([...Object.keys(before.assets || {}), ...Object.keys(after.assets || {})])].filter(file => supported(file) && before.assets?.[file] !== after.assets?.[file]).sort();
  const metadata = [...new Set([...Object.keys(before.documents), ...Object.keys(after.documents)])].filter(file => {
    if (!supported(file)) return false;
    const strip = data => {
      if (!data) return null;
      const { combatText, ordersText, eventsText, ...rest } = sanitize(file, data);
      return rest;
    };
    return JSON.stringify(strip(before.documents[file])) !== JSON.stringify(strip(after.documents[file]));
  }).sort();
  return { changes, assets, metadata };
}

function renderReport(before, after) {
  const result = compareSnapshots(before, after);
  const lines = ['# Upstream translation review', '', `Repository: https://github.com/${config.repository}`, '', `From: ${before.commit}`, `To: ${after.commit}`, '',
    'Only supported expansions are included. Review findings before applying translations. The baseline records inspected source content; it does not certify every older translation.', '',
    `Rule fields changed: ${result.changes.length}. Image assets changed: ${result.assets.length}. Metadata files changed: ${result.metadata.length}.`, ''];
  for (const change of result.changes) {
    lines.push(`## ${change.title} — ${change.field}`, '', `Source card: \`${change.file}\``, `Russian counterpart: \`${change.local}\``, '',
      '**Previous English**', '', change.before ?? '(absent)', '', '**Current English**', '', change.after ?? '(removed)', '');
  }
  if (result.assets.length) lines.push('## Image changes requiring visual review', '', ...result.assets.map(file => `- \`${file}\` → \`${localPath(file)}\``), '');
  if (result.metadata.length) lines.push('## Metadata requiring review', '', ...result.metadata.map(file => `- \`${file}\``), '');
  if (!result.changes.length && !result.assets.length && !result.metadata.length) lines.push('No upstream changes in supported content.', '');
  return lines.join('\n');
}

function curlJSON(url) {
  return JSON.parse(execFileSync('curl', ['--fail', '--silent', '--show-error', '--location', '--max-time', '30', url], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
}

function fetchSnapshot(ref, before) {
  const api = `https://api.github.com/repos/${config.repository}`;
  const commit = curlJSON(`${api}/commits/${encodeURIComponent(ref)}`).sha;
  const tree = curlJSON(`${api}/git/trees/${commit}?recursive=1`);
  if (tree.truncated) throw new Error('Upstream tree was truncated; cannot generate a complete review.');
  const snapshot = { commit, documents: {}, documentShas: {}, assets: {} };
  for (const entry of tree.tree) {
    if (entry.type !== 'blob' || !supported(entry.path)) continue;
    if (entry.path.endsWith('.json')) {
      const url = `https://raw.githubusercontent.com/${config.repository}/${commit}/` + entry.path.split('/').map(encodeURIComponent).join('/');
      snapshot.documents[entry.path] = before?.documentShas?.[entry.path] === entry.sha
        ? before.documents[entry.path] : sanitize(entry.path, curlJSON(url));
      snapshot.documentShas[entry.path] = entry.sha;
    } else snapshot.assets[entry.path] = entry.sha;
  }
  return snapshot;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--help')) {
      console.log('node tools/upstream-sync.cjs [--from snapshot.json] [--to snapshot.json | --ref SHA] [--snapshot output.json] [--output review.md]');
      process.exit(0);
    }
    const option = key => { const i = args.indexOf(key); if (i < 0) return null; if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${key}`); return args[i + 1]; };
    const before = read(option('--from') || path.join(root, config.baseline));
    const after = option('--to') ? read(option('--to')) : fetchSnapshot(option('--ref') || 'HEAD', before);
    const report = renderReport(before, after);
    if (option('--output')) fs.writeFileSync(option('--output'), report);
    else process.stdout.write(report);
    if (option('--snapshot')) fs.writeFileSync(option('--snapshot'), JSON.stringify(after, null, 2) + '\n');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { supported, sanitize, localPath, cards, compareSnapshots, renderReport };
