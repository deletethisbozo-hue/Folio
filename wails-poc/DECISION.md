# Wails migration decision

Decision: **do not migrate Folio 2.1.2 to Wails under the current architecture.**

Measured on the same Windows 2025 GitHub runner:

- Installed Electron 2.1.2 footprint: 1,396,592,050 bytes
- Wails shell with the exact current React/Vite production UI: 12,178,432 bytes
- Installed Electron renderer ready: 951 ms
- Wails shell DOM ready: 3,223 ms
- Installed Electron idle memory: 358.9 MB
- Wails best-case idle memory: 330.5 MB
- Installed Pandoc resource: 233,647,645 bytes
- Installed Chromium/Puppeteer resource: 730,613,903 bytes
- Projected Wails footprint if current print resources remain: 976,439,980 bytes
- Projected compressed Wails distribution if current print resources remain: 249,994,893 bytes
- Current setup download: 372,573,145 bytes

Keeping today's print runtime would reduce installed footprint by only 30.1% and download size by about 32.9%, while the measured best-case Wails shell starts slower and saves only 7.9% idle memory.

The shell migration therefore fails the user's requirement that the change produce a large, meaningful improvement.

The higher-value next target is the print/PDF runtime: Folio currently bundles a separate Puppeteer Chromium even though Electron already embeds Chromium. Reusing Electron's hidden BrowserWindow/webContents for Paged.js and PDF generation may eliminate the extra browser runtime without replacing the desktop shell.

This branch is benchmark evidence only and must not be merged as a migration.
