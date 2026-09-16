import { promises as fs } from "node:fs";

const file = "web/src/App.tsx";
let source = await fs.readFile(file, "utf8");

function replaceOnce(before, after, label) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`Patch anchor missing: ${label}`);
  if (source.indexOf(before, index + before.length) >= 0) throw new Error(`Patch anchor not unique: ${label}`);
  source = source.slice(0, index) + after + source.slice(index + before.length);
}

replaceOnce(
  '    const current = frame?.contentDocument;\n    const scrollTop = current?.scrollingElement?.scrollTop ?? 0;\n    if (current?.head && current.body) {',
  '    const current = frame?.contentDocument;\n    const scrollTop = current?.scrollingElement?.scrollTop ?? 0;\n    // Print preview is already paginated static HTML. Replacing its head/body in\n    // place can leave the iframe in the previous reader document lifecycle and\n    // makes Reader → Print intermittently show no physical pages. Cross the\n    // print boundary with a real srcDoc navigation instead.\n    const crossesPrintBoundary = previewMode === "print" || frame?.dataset.folioLoadedMode === "print";\n    if (current?.head && current.body && !crossesPrintBoundary) {',
  "force real iframe navigation across print boundary",
);

replaceOnce(
  '  function onPreviewLoad(restoreScroll?: number, geometryOnly = false, forceRecompose = false) {\n    const frame = previewRef.current;\n    const doc = frame?.contentDocument;\n    if (!doc?.head || !frame) return;',
  '  function onPreviewLoad(restoreScroll?: number, geometryOnly = false, forceRecompose = false) {\n    const frame = previewRef.current;\n    const doc = frame?.contentDocument;\n    if (!doc?.head || !frame) return;\n    frame.dataset.folioLoadedMode = previewMode;',
  "record loaded preview mode",
);

replaceOnce(
  'key={`${project.projectId}:${selectedId}`} ref={previewRef}',
  'key={`${project.projectId}:${selectedId}:${previewMode}`} ref={previewRef}',
  "separate reader and print iframe lifecycles",
);

await fs.writeFile(file, source, "utf8");
console.log("Applied Folio 2.0 print preview iframe fix.");
