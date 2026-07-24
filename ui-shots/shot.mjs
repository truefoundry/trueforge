import path from 'node:path';
import { chromium } from '../packages/frontend/node_modules/playwright-core/index.mjs';

const url = process.argv[2] ?? 'http://localhost:3000/';
const filename = process.argv[3] ?? 'current.png';
const outputPath = path.resolve(import.meta.dirname, filename);

if (path.extname(outputPath) !== '.png' || path.dirname(outputPath) !== import.meta.dirname) {
  throw new Error('Screenshot output must be a PNG filename inside ui-shots/');
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: outputPath });
  console.log(`Saved ${outputPath}`);
} finally {
  await browser.close();
}
