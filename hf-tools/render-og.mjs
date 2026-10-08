// Renders public/og.jpg from og.html with headless Chromium. Run from app/public.
import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto("file://" + process.cwd() + "/og.html", { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
await page.screenshot({ path: "og.jpg", type: "jpeg", quality: 86 });
await browser.close();
console.log("og.jpg written");
