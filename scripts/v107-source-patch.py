from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(path: str, old: str, new: str) -> None:
    target = ROOT / path
    value = target.read_text(encoding="utf-8")
    if new in value:
        print(f"{path}: already patched")
        return
    if old not in value:
        raise RuntimeError(f"expected compositor marker missing in {path}")
    target.write_text(value.replace(old, new, 1), encoding="utf-8")


web_old = """  const maxWordSpacing = emergency
    ? Math.min(spaceWidth * 0.48, fontSize * 0.14)
    : Math.min(spaceWidth * 0.38, fontSize * 0.115);
  const minWordSpacing = emergency
    ? -Math.min(spaceWidth * 0.18, fontSize * 0.045)
    : -Math.min(spaceWidth * 0.14, fontSize * 0.035);
  const maxTracking = fontSize * (emergency ? 0.007 : 0.0055);
  const minTracking = -fontSize * (emergency ? 0.0045 : 0.0035);
"""
web_new = """  const maxWordSpacing = emergency
    ? Math.min(spaceWidth * 0.48, fontSize * 0.14)
    : Math.min(spaceWidth * 0.50, fontSize * 0.115);
  const minWordSpacing = -Math.min(spaceWidth * 0.18, fontSize * 0.045);
  const maxTracking = fontSize * (emergency ? 0.007 : 0.0055);
  const minTracking = -fontSize * 0.0045;
"""

server_old = """      const maxWordSpacing = emergency
        ? Math.min(spaceWidth * 0.48, fontSize * 0.14)
        : Math.min(spaceWidth * 0.38, fontSize * 0.115);
      const minWordSpacing = emergency
        ? -Math.min(spaceWidth * 0.18, fontSize * 0.045)
        : -Math.min(spaceWidth * 0.14, fontSize * 0.035);
      const maxTracking = fontSize * (emergency ? 0.007 : 0.0055);
      const minTracking = -fontSize * (emergency ? 0.0045 : 0.0035);
"""
server_new = """      const maxWordSpacing = emergency
        ? Math.min(spaceWidth * 0.48, fontSize * 0.14)
        : Math.min(spaceWidth * 0.50, fontSize * 0.115);
      const minWordSpacing = -Math.min(spaceWidth * 0.18, fontSize * 0.045);
      const maxTracking = fontSize * (emergency ? 0.007 : 0.0055);
      const minTracking = -fontSize * 0.0045;
"""

patch("web/src/compositor.ts", web_old, web_new)
patch("server/pipeline/compositor.ts", server_old, server_new)
print("Strict compositor now uses the full QA-safe spacing envelope")
