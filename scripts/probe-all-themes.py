from pathlib import Path

path = Path('scripts/v107-visual-qa.ts')
text = path.read_text(encoding='utf-8')
start = text.index('  await setLanguage("pl");')
end = text.index('} finally {', start)
replacement = r'''  const getThemeNames = async (): Promise<string[]> => {
    await page.click('[data-command="design"]');
    await page.waitForSelector('.style-category-list');
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('.style-category-list button')]
        .find((node) => node.textContent === 'Book Style');
      (button as HTMLButtonElement | undefined)?.click();
    });
    await page.waitForSelector('.theme-gallery .theme-sample[data-theme]');
    const names = await page.$$eval('.theme-gallery .theme-sample[data-theme]', (nodes) =>
      nodes.map((node) => node.getAttribute('data-theme') || '').filter(Boolean));
    await page.click('.style-library-header button');
    return names;
  };

  const setTheme = async (theme: string) => {
    await page.click('[data-command="design"]');
    await page.waitForSelector('.style-category-list');
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('.style-category-list button')]
        .find((node) => node.textContent === 'Book Style');
      (button as HTMLButtonElement | undefined)?.click();
    });
    await page.waitForSelector(`.theme-sample[data-theme="${theme}"]`);
    await page.click(`.theme-sample[data-theme="${theme}"]`);
    await page.waitForFunction((value) =>
      document.querySelector('.theme-sample.selected')?.getAttribute('data-theme') === value, {}, theme);
    await page.click('.style-library-header button');
    await page.waitForSelector('.preview-loading', { hidden: true });
    await new Promise((resolve) => setTimeout(resolve, 350));
  };

  const themeNames = await getThemeNames();
  const matrix: Record<string, unknown> = {};
  const failures: Array<{ theme: string; stage: string; error: string }> = [];

  for (const theme of themeNames) {
    const result: Record<string, unknown> = {};
    matrix[theme] = result;
    try {
      await setTheme(theme);
      await setLanguage('pl');
      await setDropcap(false);
      const polishNeedle = await replaceEditor(polish);
      try { result.polish = await metrics(`${theme}-polish`, polishNeedle); }
      catch (error) { failures.push({ theme, stage: 'pl', error: error instanceof Error ? error.message : String(error) }); }

      await setDropcap(true);
      try { result.polishDropcap = await metrics(`${theme}-polish-dropcap`, polishNeedle); }
      catch (error) { failures.push({ theme, stage: 'pl-dropcap', error: error instanceof Error ? error.message : String(error) }); }

      await setLanguage('en');
      await setDropcap(false);
      const englishNeedle = await replaceEditor(english);
      try { result.english = await metrics(`${theme}-english`, englishNeedle); }
      catch (error) { failures.push({ theme, stage: 'en', error: error instanceof Error ? error.message : String(error) }); }
    } catch (error) {
      failures.push({ theme, stage: 'setup', error: error instanceof Error ? error.message : String(error) });
    }
    console.log(`THEME_RESULT ${theme} ${failures.some((failure) => failure.theme === theme) ? 'FAIL' : 'PASS'}`);
  }

  await fs.writeFile(path.join(qa, 'all-theme-matrix.json'), JSON.stringify({ themeNames, failures, matrix }, null, 2) + '\n', 'utf8');
  console.log(`THEME_MATRIX ${themeNames.length} themes, ${failures.length} failures`);
  for (const failure of failures) console.log(`THEME_FAILURE ${failure.theme} ${failure.stage} ${failure.error}`);
  if (themeNames.length < 30) throw new Error(`Theme matrix discovered only ${themeNames.length} themes`);
  if (failures.length) throw new Error(`All-theme QA failed: ${failures.length} scenario failures`);
'''
path.write_text(text[:start] + replacement + text[end:], encoding='utf-8')
