#!/usr/bin/env node
// Optional authoring dependency: npm install --no-save sharp
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require(process.env.SHARP_MODULE || 'sharp');
const page = path.resolve(__dirname, '../page');

async function files(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const groups = await Promise.all(entries.map(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  return groups.flat();
}

(async () => {
  const sources = (await files(path.join(page, 'factions'))).filter(p => /\/(combat|orders|events|backs)\/[^/]+\.jpg$/.test(p));
  const manifest = {};
  // Small batches keep authoring memory bounded too.
  for (let start = 0; start < sources.length; start += 4) {
    await Promise.all(sources.slice(start, start + 4).map(async source => {
      const relative = path.relative(page, source);
      const target = path.join(page, 'thumbnails', relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await sharp(source).resize({ width: 270, height: 390, fit: 'fill' }).jpeg({ quality: 78, mozjpeg: true }).toFile(target);
      manifest[relative] = { sourceBytes: (await fs.stat(source)).size, thumbnailBytes: (await fs.stat(target)).size };
    }));
  }
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  await fs.writeFile(path.join(page, 'thumbnails/manifest.json'), JSON.stringify(sorted, null, 2) + '\n');
  const sum = field => Object.values(manifest).reduce((n, entry) => n + entry[field], 0);
  console.log(`${sources.length} thumbnails: ${sum('thumbnailBytes')} bytes instead of ${sum('sourceBytes')} source bytes.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
