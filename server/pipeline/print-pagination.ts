import { autoGutter, type PrintOptions } from "../print.ts";

/** Preview and PDF must use the same final page-count-dependent inner margin. */
export async function paginateToFinalGutter<T>(options: PrintOptions, paginate: (options: PrintOptions) => Promise<{ result: T; meta: { pages: number; gutter: number } }>): Promise<{ result: T; meta: { pages: number; gutter: number } }> {
  let current = options;
  for (let pass = 0; pass < 6; pass++) {
    const rendered = await paginate(current);
    if (options.gutter !== undefined) return rendered;
    const gutter = autoGutter(rendered.meta.pages, options.binding);
    if (Math.abs(gutter - rendered.meta.gutter) <= .001) return rendered;
    current = { ...options, gutter };
  }
  throw new Error("Automatic print gutter did not converge. Choose a manual inner margin and run Preflight again.");
}
