const fs = require('fs');
const esbuild = require('esbuild');

const srcDir = 'public/js';
const files = ['drag-drop.js', 'musicbrainz.js', 'app.js'];
const temp = `${srcDir}/__bundle-temp.js`;
const out = `${srcDir}/bundle.js`;

fs.writeFileSync(temp, files.map(f => fs.readFileSync(`${srcDir}/${f}`, 'utf8')).join('\n'));

esbuild.buildSync({
  entryPoints: [temp],
  bundle: false,
  minify: true,
  outfile: out,
  format: 'iife'
});

fs.unlinkSync(temp);
