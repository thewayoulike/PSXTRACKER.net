import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import sqlite3pkg from 'sqlite3';

const { Database } = sqlite3pkg;
chromium.use(stealth());

// Database Connection
const db = new Database('/var/www/psxtracker/psx_data.db');

// Ensure the historical table exists
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS historical_data (
        ticker TEXT,
        date TEXT,
        open REAL,
        high REAL,
        low REAL,
        close REAL,
        volume INTEGER,
        PRIMARY KEY (ticker, date)
    )`);
});

async function scrapeHistorical(ticker) {
    console.log(`[${new Date().toLocaleString()}] 🕒 Starting historical scrape for ${ticker}...`);
    
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        // 1. Navigate to the historical page
        // The URL typically uses the symbol in the path: /historical/SYMBOL
        await page.goto(`https://dps.psx.com.pk/historical`, { waitUntil: 'networkidle' });

        // 2. Search for the symbol if not already on the page
        await page.fill('input[placeholder*="Search"]', ticker);
        await page.press('input[placeholder*="Search"]', 'Enter');
        await page.waitForTimeout(3000); // Wait for results to load

        // 3. Extract the table data
        const data = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('table tbody tr'));
            return rows.map(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length < 6) return null;
                return {
                    date: cells[0].innerText.trim(),
                    open: parseFloat(cells[1].innerText.replace(/,/g, '')),
                    high: parseFloat(cells[2].innerText.replace(/,/g, '')),
                    low: parseFloat(cells[3].innerText.replace(/,/g, '')),
                    close: parseFloat(cells[4].innerText.replace(/,/g, '')),
                    volume: parseInt(cells[5].innerText.replace(/,/g, ''))
                };
            }).filter(r => r !== null);
        });

        console.log(`📝 Found ${data.length} historical records for ${ticker}.`);

        // 4. Save to Database
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            const stmt = db.prepare("INSERT OR REPLACE INTO historical_data (ticker, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)");
            data.forEach(row => {
                stmt.run(ticker, row.date, row.open, row.high, row.low, row.close, row.volume);
            });
            stmt.finalize();
            db.run("COMMIT");
        });

        console.log(`✅ Success: Historical data for ${ticker} updated.`);
    } catch (error) {
        console.error(`❌ Scrape Failed for ${ticker}: ${error.message}`);
    } finally {
        await browser.close();
    }
}

// Example usage:
const targetTicker = process.argv[2] || 'FNEL';
scrapeHistorical(targetTicker);
