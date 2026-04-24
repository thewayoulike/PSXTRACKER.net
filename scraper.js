import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import sqlite3pkg from 'sqlite3';
const { Database } = sqlite3pkg;

chromium.use(stealth());
const db = new Database('/var/www/psxtracker/psx_data.db');

async function scrape() {
    console.log(`[${new Date().toLocaleString()}] 🚀 Harvesting CURRENT prices...`);
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();

    try {
        await page.goto('https://dps.psx.com.pk/market-watch', { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForSelector('table', { timeout: 30000 });

        const stocks = await page.evaluate(() => {
            const data = [];
            const table = document.querySelector('table');
            if (!table) return [];

            const rows = Array.from(table.querySelectorAll('tr'));
            
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                // Target index 7 for "Current" and index 3 for "LDCP"
                if (cells.length >= 8) {
                    const ticker = cells[0].innerText.trim();
                    const price = parseFloat(cells[7].innerText.replace(/,/g, ''));
                    const ldcp = parseFloat(cells[3].innerText.replace(/,/g, ''));
                    
                    if (ticker && ticker.length <= 10 && !isNaN(price)) {
                        data.push({ ticker, price, ldcp });
                    }
                }
            });
            return data;
        });

        if (stocks.length > 0) {
            console.log(`✅ Success! Found ${stocks.length} stocks with correct prices.`);
            const now = new Date().toISOString();
            db.serialize(() => {
                db.run("BEGIN TRANSACTION");
                const stmt = db.prepare("INSERT OR REPLACE INTO live_prices (ticker, price, ldcp, updated_at) VALUES (?, ?, ?, ?)");
                stocks.forEach(s => stmt.run(s.ticker.toUpperCase(), s.price, s.ldcp, now));
                stmt.finalize();
                db.run("COMMIT");
            });
        }
    } catch (error) {
        console.error("❌ Scrape Error:", error.message);
    } finally {
        await browser.close();
    }
}
scrape();
