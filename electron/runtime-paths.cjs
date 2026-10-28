const fs = require("node:fs");
const path = require("node:path");

function firstMatchingFile(root, names) {
  if (!root || !fs.existsSync(root)) return null;
  // Search the complete tree for each preferred executable in turn. Directory
  // traversal order must never choose a different renderer from qualification.
  for (const name of names) {
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return full;
      }
    }
  }
  return null;
}
module.exports = { firstMatchingFile };
