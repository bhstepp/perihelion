// Test helper: runs tools/build.js, then returns the HTML file the flow tests should load.
const path = require('path'), cp = require('child_process');
const root = path.join(__dirname, '..');
function build() {
  cp.execFileSync('node', [path.join(__dirname, 'build.js')], { stdio: 'inherit' });
  const n = require('./load.js').load(['00-const.js', '10-physics.js', '20-levels.js']).Levels.CAMPAIGN.length;
  return { file: path.join(root, 'dist', 'perihelion.html'), levels: n, stub: false };
}
module.exports = build;
if (require.main === module) console.log(build());
