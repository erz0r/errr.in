import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME ?? {
  win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
}[process.platform] ?? '/usr/bin/google-chrome';
const PORT = Number(process.env.PORT ?? 5173);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: false });
try {
  const page = (await browser.pages())[0];
  await page.setViewport({ width: 1200, height: 630 });
  await page.goto(`http://localhost:${PORT}/?tune`);
  await page.evaluate(() => document.body.classList.add('tune-hidden'));
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: 'site/media/preview.png' });
  console.log('wrote site/media/preview.png');
} finally {
  await browser.close();
}
