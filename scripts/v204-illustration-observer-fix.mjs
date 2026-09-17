import fs from 'node:fs';

const path = 'web/src/illustration-controls.ts';
let source = fs.readFileSync(path, 'utf8');
const from = `  if (cropButton) {\n    cropButton.textContent = crop ? "Crop on" : "Crop";\n    cropButton.setAttribute("aria-pressed", String(crop));\n  }`;
const to = `  if (cropButton) {\n    // MutationObserver watches child-list changes. Assigning textContent on every\n    // hydration creates a self-triggering microtask loop that can freeze the UI\n    // immediately after an illustration is inserted. Keep DOM writes idempotent.\n    const label = crop ? "Crop on" : "Crop";\n    if (cropButton.textContent !== label) cropButton.textContent = label;\n    if (cropButton.getAttribute("aria-pressed") !== String(crop)) cropButton.setAttribute("aria-pressed", String(crop));\n  }`;
if (!source.includes(from)) throw new Error('Missing crop button refresh anchor');
source = source.replace(from, to);
fs.writeFileSync(path, source);
console.log('Applied 2.0.4 illustration observer loop fix.');
