from pathlib import Path

for path in (Path('web/src/compositor.ts'), Path('server/pipeline/compositor.ts')):
    text = path.read_text(encoding='utf-8')
    marker = '.filter((word) => word.spaceBefore).length;'
    idx = text.find(marker)
    if idx < 0:
        raise SystemExit(f'missing semantic word marker in {path}')
    insert_at = idx + len(marker)
    guard = '\n' + ('        ' if str(path).startswith('web/') else '            ') + 'if (last && semanticWordsOnLine === 1 && words.length > 1) continue;'
    if guard.strip() not in text:
        text = text[:insert_at] + guard + text[insert_at:]
    path.write_text(text, encoding='utf-8')
