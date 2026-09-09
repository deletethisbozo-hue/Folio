declare module "hypher" {
  export default class Hypher {
    constructor(language: unknown);
    hyphenate(word: string): string[];
  }
}

declare module "hyphenation.pl" {
  const patterns: unknown;
  export default patterns;
}

declare module "hyphenation.en-us" {
  const patterns: unknown;
  export default patterns;
}
