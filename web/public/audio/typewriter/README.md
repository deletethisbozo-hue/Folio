# Folio Typewriter Sound sample bank

These compact assets are processed excerpts prepared for Folio from reference sound effects supplied by the project owner.

- `classic-keys.mp3` / `soft-keys.mp3`: rebuilt for 2.8.4 from six isolated single-onset typebar strikes in `freesound_community-typewriter-typing-68696.mp3`. Soft applies a gentler runtime profile to the same clean physical strikes.
- `mechanical-keys.mp3`: rebuilt for 2.8.4 from six isolated single-onset harder strikes in `kave_msri-typewriter-sound-effect-312919.mp3`.
- `space-keys.mp3`: rebuilt for 2.8.4 from three short isolated mechanism clicks. Each slot contains one principal onset, is high-passed at 520 Hz during asset preparation, and is deliberately brighter/shorter than the 2.8.2–2.8.3 spacebar thump.
- `backspace-keys.mp3`: three isolated carriage/ratchet clicks derived from `freesound_community-typewriter-scrolling-44786.mp3`, used only for Backspace/Delete.
- `carriage-return.mp3`: carriage/scroll mechanism derived from `freesound_community-typewriter-scrolling-44786.mp3`.
- The Enter bell is synthesized from measured dominant partials of the supplied `freesound_community-typewriter-bell-100087.mp3` reference.

Only short processed UI samples are shipped; the original long reference recordings are not bundled.

## 2.8.5 balance note

The legacy `backspace-keys.mp3` asset remains in the repository for provenance but is no longer loaded at runtime. Backspace/Delete now use each preset's clean single-onset key bank with dedicated lower-gain rate/EQ profiles. This avoids the harsh ratchet character that made Backspace louder and stranger than ordinary typing in 2.8.4.
