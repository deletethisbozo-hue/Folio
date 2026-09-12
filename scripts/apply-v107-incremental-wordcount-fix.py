from pathlib import Path

path = Path("web/src/App.tsx")
text = path.read_text(encoding="utf-8")

old_ref = '''  const fastInputBurstRef = useRef(false);\n  const fastInputBurstTimerRef = useRef<number | null>(null);\n'''
new_ref = '''  const fastInputBurstRef = useRef(false);\n  const fastInputBurstTimerRef = useRef<number | null>(null);\n  const draftWordCountCacheRef = useRef<{ text: string; count: number }>({ text: "", count: 0 });\n'''
if text.count(old_ref) != 1:
    raise SystemExit(f"word-count ref target: expected 1, found {text.count(old_ref)}")
text = text.replace(old_ref, new_ref, 1)

old_count = '''  const totalWords = useMemo(() => project ? Math.max(wordCount(draft), Math.round(project.bodyChars / 5.1)) : 0, [project, draft]);\n'''
new_count = '''  const draftWords = useMemo(() => {\n    const cached = draftWordCountCacheRef.current;\n    if (draft === cached.text) return cached.count;\n\n    const appendLength = draft.length - cached.text.length;\n    let count: number;\n    if (cached.text.length > 0 && appendLength >= 0 && appendLength <= 2048 && draft.startsWith(cached.text)) {\n      // Huge-manuscript fast typing is append-only. Count only whitespace ->\n      // non-whitespace transitions in the appended tail instead of allocating a\n      // 100k-entry regex result array for every single keystroke.\n      count = cached.count;\n      let previousNonWhitespace = /\\S/.test(cached.text.slice(-1));\n      for (let index = cached.text.length; index < draft.length; index++) {\n        const currentNonWhitespace = !/\\s/.test(draft[index]);\n        if (currentNonWhitespace && !previousNonWhitespace) count++;\n        previousNonWhitespace = currentNonWhitespace;\n      }\n    } else {\n      count = wordCount(draft);\n    }\n    draftWordCountCacheRef.current = { text: draft, count };\n    return count;\n  }, [draft]);\n  const totalWords = useMemo(() => project ? Math.max(draftWords, Math.round(project.bodyChars / 5.1)) : 0, [project, draftWords]);\n'''
if text.count(old_count) != 1:
    raise SystemExit(f"word-count calculation target: expected 1, found {text.count(old_count)}")
text = text.replace(old_count, new_count, 1)

path.write_text(text, encoding="utf-8")
