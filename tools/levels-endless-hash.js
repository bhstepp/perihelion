// helper: hash of Levels.generate over 78 (seed, d<=1) pairs. usage: node tools/levels-endless-hash.js [path/to/20-levels.js]
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
function endlessHash(levelsPath) {
  const src = [path.join(ROOT, 'src', '00-const.js'), path.join(ROOT, 'src', '10-physics.js'), levelsPath].map(f => fs.readFileSync(f, 'utf8')).join('\n');
  const G = vm.runInThisContext('(function(){' + src + '\n;return {Levels:Levels};})()');
  const h = require('crypto').createHash('sha256');
  for (let q = 0; q < 78; q++) h.update(JSON.stringify(G.Levels.generate(1 + q * 7919, (q % 26) / 25)));
  return h.digest('hex');
}
module.exports = endlessHash;
if (require.main === module) console.log(endlessHash(path.resolve(process.argv[2] || path.join(ROOT, 'src', '20-levels.js'))));
