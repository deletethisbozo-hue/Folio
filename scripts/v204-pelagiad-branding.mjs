import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s);
function replaceOnce(path, from, to) {
  const source = read(path);
  if (!source.includes(from)) throw new Error(`Missing anchor in ${path}: ${from.slice(0, 100)}`);
  write(path, source.replace(from, to));
}

replaceOnce(
  'web/src/main.tsx',
  'import "./v204-polish.css";',
  'import "./v204-polish.css";\nimport "./pelagiad-branding.css";',
);

let app = read('web/src/App.tsx');
app = app
  .replaceAll('<div className="folio-wordmark">Folio</div>', '<div className="folio-wordmark">folio</div>')
  .replaceAll('<div className="command-wordmark">Folio</div>', '<div className="command-wordmark">folio</div>')
  .replaceAll('<h1>Folio</h1>', '<h1>folio</h1>')
  .replaceAll('<span className="preview-pane-title">Page Preview</span>', '<span className="preview-pane-title">Page Preview</span>');
write('web/src/App.tsx', app);

let start = read('web/src/StartScreen.tsx');
start = start
  .replaceAll('<div className="start-brand">Folio</div>', '<div className="start-brand">folio</div>')
  .replaceAll('<i>Folio</i>', '<i>folio</i>')
  .replaceAll('Books you open in Folio will appear here automatically.', 'Books you open in folio will appear here automatically.');
write('web/src/StartScreen.tsx', start);

console.log('Applied Pelagiad application branding and lowercase folio wordmarks.');
