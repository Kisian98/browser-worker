import { access } from 'node:fs/promises';

async function defaultLaunchBrowser() {
  const { chromium } = await import('playwright');
  return chromium.launch({ headless: true });
}

export async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function runIsolatedCapturePage({
  targetUrl,
  screenshotPath,
  launchBrowser = defaultLaunchBrowser
}) {
  const browser = await launchBrowser();
  let context;
  let page;

  try {
    context = await browser.newContext();
    page = await context.newPage();
    const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await page.screenshot({ path: screenshotPath, fullPage: true });

    return {
      finalUrl: page.url(),
      title: await page.title(),
      httpStatus: response?.status?.() ?? null,
      screenshotCreated: await fileExists(screenshotPath)
    };
  } finally {
    await page?.close?.();
    await context?.close?.();
    await browser?.close?.();
  }
}
