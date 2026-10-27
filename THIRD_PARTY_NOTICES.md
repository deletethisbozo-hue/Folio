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

## EPUB publishing runtime (Folio 3.3)

Windows distributions include EPUBCheck 5.4.0 from the W3C EPUBCheck project
(https://github.com/w3c/epubcheck), under its BSD-3-Clause license and the
licenses of its dependencies. The full official distribution, including
LICENSE.txt, THIRD-PARTY.txt and licenses/, is retained in
app-resources/vendor/epubcheck.

They also include Eclipse Temurin OpenJDK 21.0.12.1+1 JRE for Windows x64
(https://github.com/adoptium/temurin21-binaries), under GPLv2 with the Classpath
Exception and the notices in the included legal/ directory. Corresponding
OpenJDK source is available from https://github.com/adoptium/jdk21u at
jdk-21.0.12.1+1. The distribution's own LICENSE, NOTICE and legal files are
shipped in app-resources/java. Neither runtime is downloaded at application
startup. Build inputs are pinned by SHA-256 in scripts/setup-publishing-tools.mjs.
