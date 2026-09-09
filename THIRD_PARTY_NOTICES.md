# Third-party notices

Folio is based on Byte-Sized Book Formatter by Angie Hartwell and retains its MIT license and copyright notice.

The Windows release also distributes separate third-party executables/resources used by Folio at runtime:

- **Pandoc**, Copyright John MacFarlane and contributors, licensed under the GNU General Public License. The Windows build downloads Pandoc from its official GitHub release during CI and includes the license file from that distribution when available. Source and license information: https://github.com/jgm/pandoc
- **Chrome Headless Shell / Chromium**, distributed as the browser engine used by Puppeteer for PDF rendering. Chromium is licensed under the BSD license and includes components under additional open-source licenses. Source and license information: https://www.chromium.org/Home/
- **Electron**, MIT licensed. Source: https://github.com/electron/electron
- **Puppeteer**, Apache-2.0 licensed. Source: https://github.com/puppeteer/puppeteer
- **Hypher**, Copyright Bram Stein, BSD-3-Clause licensed. Source: https://github.com/bramstein/Hypher
- **hyphenation.pl / hyphenation.en-us**, language pattern datasets packaged for Hypher and used only to calculate discretionary line breaks. Package source: https://www.npmjs.com/package/hyphenation.pl and https://www.npmjs.com/package/hyphenation.en-us

These components remain separate works under their respective licenses.
