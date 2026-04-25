import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import sqlite3pkg from 'sqlite3';
import webpush from 'web-push';

const { Database } = sqlite3pkg;
chromium.use(stealth());
const db = new Database('/var/www/psxtracker/psx_data.db');

// --- 🔴 PASTE YOUR KEYS HERE ---
const publicVapidKey = 'BOQirLyVkFOMp0DGyxgzq8oraIRq5FVopRlewMjLCn3VuIih8rak8BM_iiLCxIkMvDAoFlj8XulePa3RsByI6sQ';
const privateVapidKey = 'THsU_Jjbg6a1fv0Z3sNo4eRRIW5DQ3tAZnJdIw9_Wgo';
// --------------------------------

webpush.setVapidDetails('mailto:support@psxtracker.com', publicVapidKey, privateVapidKey);

const CHECK_INTERVAL = 120000; // 2 minutes
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function sendMobilePush(title, body) {
    db.all("SELECT subscription FROM push_subscriptions", [], (err, rows) => {
        if (err || !rows) return;
        rows.forEach(row => {
            const sub = JSON.parse(row.subscription);
            webpush.sendNotification(sub, JSON.stringify({ title, body }))
                .catch(err => console.error("Push delivery failed:", err.message));
        });
    });
}

async function checkAlerts(currentPrices) {
    db.all("SELECT * FROM price_alerts WHERE is_active = 1", [], async (err, alerts) => {
        if (err || !alerts) return;

        for (const alert of alerts) {
            const livePrice = currentPrices[alert.ticker];
            if (!livePrice) continue;

            let triggered = false;
            if (alert.condition === 'ABOVE' && livePrice >= alert.target_price) triggered = true;
            if (alert.condition === 'BELOW' && livePrice <= alert.target_price) triggered = true;

            if (triggered) {
                const title = `🚀 Price Alert: ${alert.ticker}`;
                const body = `${alert.ticker} hit ${livePrice}! Target was ${alert.target_price} (${alert.condition})`;
                await sendMobilePush(title, body);
                
                db.run("UPDATE price_alerts SET is_active = 0 WHERE id = ?", [alert.id]);
            }
        }
    });
}

async function scrapeLoop() {
    while (true) {
        console.log(`[${new Date().toLocaleString()}] 🔄 Scraping for prices and alerts...`);
        const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
        
        try {
            const context = await browser.newContext();
            const page = await context.newPage();
            await page.goto('https://dps.psx.com.pk/market-watch', { waitUntil: 'networkidle', timeout: 60000 });
            await page.waitForSelector('table', { timeout: 30000 });

            const stocks = await page.evaluate(() => {
                const data = {};
                const table = document.querySelector('table');
                if (!table) return {};

                const rows = Array.from(table.querySelectorAll('tr'));
                rows.forEach(row => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length >= 8) {
                        const rawTicker = cells[0].innerText.trim();
                        const ticker = rawTicker.split(/[\s-]/)[0].toUpperCase();
                        
                        const price = parseFloat(cells[7].innerText.replace(/,/g, ''));
                        const ldcp = parseFloat(cells[3].innerText.replace(/,/g, ''));
                        
                        if (ticker && ticker.length <= 10 && !isNaN(price)) {
                            data[ticker] = { price, ldcp };
                        }
                    }
                });
                return data;
            });

            const tickerKeys = Object.keys(stocks);
            if (tickerKeys.length > 0) {
                console.log(`✅ Success! Updated ${tickerKeys.length} stocks in database.`);
                const now = new Date().toISOString();
                
                db.serialize(() => {
                    db.run("BEGIN TRANSACTION");
                    const stmt = db.prepare("INSERT OR REPLACE INTO live_prices (ticker, price, ldcp, updated_at) VALUES (?, ?, ?, ?)");
                    tickerKeys.forEach(t => stmt.run(t, stocks[t].price, stocks[t].ldcp, now));
                    stmt.finalize();
                    db.run("COMMIT");
                });

                // Check active alerts against new prices
                const priceMap = {};
                tickerKeys.forEach(t => priceMap[t] = stocks[t].price);
                await checkAlerts(priceMap);
            }
        } catch (error) {
            console.error("❌ Scrape Error:", error.message);
        } finally {
            await browser.close();
            console.log(`[${new Date().toLocaleString()}] 😴 Sleeping for 2 minutes...`);
            await sleep(CHECK_INTERVAL);
        }
    }
}

scrapeLoop();
