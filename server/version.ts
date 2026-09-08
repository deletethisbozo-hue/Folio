import { createRequire } from "node:module";

// Read from package.json rather than repeating the number here. The two had
// already drifted once — /api/health went on reporting 1.1.0 after the package
// moved on — and a version string that can lie is worse than none.
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { name: string; version: string; build?: { productName?: string } };

export const APP_NAME = pkg.build?.productName ?? "Folio";
export const APP_VERSION = pkg.version;
