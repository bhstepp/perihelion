// Node helper: loads the pure (DOM-free) modules into an isolated vm context and returns them.
// usage: const G = require('./tools/load.js'); G.Physics.simulate(...)
// (Don't destructure to a top-level `K` in node -e scripts; use G.K.)
const fs = require('fs'), path = require('path'), vm = require('vm');
function load(files) {
  const ctx = vm.createContext({ console });
  for (const f of files || ['00-const.js', '10-physics.js', '20-levels.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), ctx, { filename: f });
  return ctx;
}
module.exports = load();
module.exports.load = load;
