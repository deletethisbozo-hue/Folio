import path from "node:path";
import { promises as fs } from "node:fs";
import { makeBookFixture } from "./fixtures/book.ts";
import { loadBook } from "../server/pipeline/ingest.ts";
import { renderEpub } from "../server/pipeline/render-epub.ts";
import { readEpubEntries } from "../server/pipeline/epub-zip.ts";

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? passed++ : failed++;
};

console.log("\nFolio illustration V2 EPUB");

const fixture = await makeBookFixture();
try {
  const assetsDir = path.join(fixture.bookDir, "assets");
  await fs.mkdir(assetsDir, { recursive: true });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAPAAAAFACAIAAAANimYEAAAFjUlEQVR42u3d0W6bWhCGUbLF+79yehGprepCMA54zz9rXZ4eNTZ8GQ9pjD8+Pz8XSDEcAgQNggZBg6ARNAgaZrNu/cHHx4ejw7S2/v3EhMbKAYKGd+7QR/YVuNOR6zoTGisHCBoEDYJG0CBoEDQIGgSNoEHQIGgQNAgaQYOgQdAgaBA0ggZBg6BB0CBoBA2CBkGDoEHQCBoEDYIGQYOgETQIGgQNgkbQIGgQNFxtdQh+1pGP7/2HT54WdOF8j/wlEhd0pYKf/Sr6FnTJjr/96soWdOGOlS3o93d8IrUTX07Zgr6krR/p6fEvOf4wvv5PWQv6fMo31PP3lzjywGQt6OdSfmMrx+OWdfegJ09568HIWtBPpzxzEL8f286zaJv1UPNjLlU6+PahzvZjRxP67pQrPqn9PaTbqB5qrjWVzz2FPqN6lXLSM92Z1k1G9Whbc8BUPjGt40f1aFtz/Hdyz6ZXKcc3/XgogtePoWajWtBq1rSg31dz8PXf61eKYU2PDjUv7B6NpKaHmjWd1PRQs6aTmh5q1nRS00PNmk5qeqhZ00lNDzVrOqnpEX9uaHXcqgbtfnBXN110SA81k9T0UDNJTbvhOVGKBW08G9I5QatZ08krh5od28JBN7xniuMfG7Rlw+KRvHKo2XEuHLRlw7lIntDGs6NdOGjj2RlJntDGs2NeOGjj2XlJntDGsyNfOGjj2ZBOntDGs+NfOGjj2ZBOntDGs7MQeFEIJYO2b9g6kie0fcO5sHJg5ZjyVcx4nnxIz7Z1mNCY0CDoolfN1DprU09oC7TzYuXAygGCBkE/cW1hgS60Rs9zXWhCY0KDoEHQIGgE/XZ+xFHOnD/oMKExoUHQIGgQNIIGQYOgQdAgaAQNggZBg6BB0AgaBP2ayW/SyqM535NhQmNCg6BB0CBoBD0DP+goZNrbTpjQmNAgaOgetDXaeakdtFvaVTTVWbNyYOUAQZ97/bJGT75Az7YlmtCY0K6pjWdBF71qptaZsnJg5fBKZ98QtK3DvmFCG9KOf0rQhrTxHH5RaEg78rWDNqSdl+QJbUg75uWDNqSdkeQJbUg72uWDNqSdi+QJbUg7zuWDfhwMmr6/5hIvlWUmtMXD8Y9dOQxpxzYhaIuHZSNtQmtazbErByQEbUgbz2kTWtNqTls5NK3m/B1a045b4aD/O0I0/SM11/1nrNoTWtNqTls5NK3mtB1a02pOuyjUtJqjgta0mtOC1rSal7zf5dhqWtZbByHsF80Dfzlp6wx1bnrruee9bSLzt+003bPmZVnW1LP4dbYez+XXf2nyhq5WKSdPaKO6Z81Lh1/w32k6Neudpxb/0rQuDWytH3kbyM63aJMtq9FbsHbOaMC03n8KfW4CsS6d7IzqutN6/1ux2/1MOr5Jdv8cF5rW3z7UhnfnWZeW9kf13380YRNHvt/a3miqadAHs55tD5GyoH8y67cUc3z/cfs/QT+X9W1xP7vES1nQr2a9Vd6Jtl65BpWyoJ+o5ERq9/yERMeCvrtsHQta2ToW9FvbuqhvBQt6lh3gROLyFXSlxLmTG54jaBA0CBoEjaBB0CBoEDQIGkGDoEHQIGgQNIIGQYOgQdAgaAQNggZBg6BB0AgaBA2CBkGDoBE0CBoEDYIGQSNoEDQIGgSNoEHQIGi42oUfjXzRB7uT4aLPkDahsXKAoKH2Dn3RkgQmNIIGQYOgQdAgaAQNggZBg6BB0AgaBA2CBkGDoBE0CBoEDYKmvbXig3YLm9uUe6ezCY2VA6wcnV8HMaFB0AjaIUDQIGgQNAgaQYOgQdAgaBA0ggZBg6BB0CBoBA2CBkGDoEHQCBoEDYIGQYOgETQIGgQNLzp0O113zMeEBkGDoOHPeuzjHTChQdAgaBA0ggZBg6DhQr8Amvx42uEUms8AAAAASUVORK5CYII=",
    "base64",
  );
  await fs.writeFile(path.join(assetsDir, "anchored-epub.png"), png);

  const { book } = await loadBook(fixture.bookDir);
  const chapter = book.sections.find((section) => section.kind === "chapter");
  if (!chapter) throw new Error("Fixture has no chapter");
  chapter.markdown = [
    "Before the image, prose remains ordinary.",
    "",
    "![Anchored EPUB illustration](assets/anchored-epub.png){.folio-illustration .folio-wrap-left width=38%}",
    "",
    "This paragraph must remain after the anchored image so an EPUB reader can flow it beside the illustration where floats are supported.",
    "",
    chapter.markdown,
  ].join("\n");

  const result = await renderEpub(book, "universal");
  const entries = await readEpubEntries(result.buffer);
  const xhtml = entries
    .filter((entry) => /\.xhtml$/i.test(entry.name))
    .map((entry) => ({ name: entry.name, text: Buffer.from(entry.data).toString("utf8") }));
  const host = xhtml.find((entry) => entry.text.includes("Anchored EPUB illustration"));
  const media = entries.filter((entry) => /anchored-epub|media\//i.test(entry.name));

  check("V2 illustration survives into EPUB XHTML", Boolean(host), host?.name ?? "missing XHTML host");
  const hostText = host?.text ?? "";
  check("EPUB preserves semantic illustration wrapper", /folio-illustration-block/.test(hostText), hostText.match(/<[^>]*folio-illustration[^>]*>/)?.[0] ?? "wrapper missing");
  check("EPUB preserves left wrap intent", /folio-wrap-left/.test(hostText), hostText.match(/class="[^"]*folio-wrap-left[^"]*"/)?.[0] ?? "wrap class missing");
  check("EPUB preserves relative width", /(?:style="[^"]*width\s*:\s*38%|width="38%")/.test(hostText), hostText.match(/(?:style|width)="[^"]*38%[^"]*"/)?.[0] ?? "38% width missing");
  check("EPUB packages the illustration asset", media.some((entry) => Buffer.from(entry.data).length > 1000), media.map((entry) => entry.name).join(", ") || "media missing");
  check("Pandoc class separator is not collapsed", !hostText.includes("folio-illustration.folio-wrap-left"));

  const cssText = entries
    .filter((entry) => /\.css$/i.test(entry.name))
    .map((entry) => Buffer.from(entry.data).toString("utf8"))
    .join("\n");
  check("EPUB stylesheet contains wrap-left float rule", /\.folio-illustration-block\.folio-wrap-left\s*\{[^}]*float\s*:\s*left/is.test(cssText));
  check("EPUB stylesheet contains wrap-right float rule", /\.folio-illustration-block\.folio-wrap-right\s*\{[^}]*float\s*:\s*right/is.test(cssText));
} catch (error) {
  failed++;
  console.error("✗ anchored EPUB scenario completed");
  console.error(error);
} finally {
  await fixture.cleanup();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
