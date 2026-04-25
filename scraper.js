import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import sqlite3pkg from 'sqlite3';
import webpush from 'web-push';

const { Database } = sqlite3pkg;
chromium.use(stealth());

// 1. Setup Database
const db = new Database('/var/www/psxtracker/psx_data.db');

// 2. Setup Push Notifications
const publicVapidKey = 'BOQirLyVkFOMp0DGyxgzq8oraIRq5FVopRlewMjLCn3VuIih8rak8BM_iiLCxIkMvDAoFlj8XulePa3RsByI6sQ';
const privateVapidKey = 'THsU_Jjbg6a1fv0Z3sNo4eRRIW5DQ3tAZnJdIw9_Wgo';
webpush.setVapidDetails('mailto:support@psxtracker.com', publicVapidKey, privateVapidKey);

const CHECK_INTERVAL = 300000; // 5 MINUTES (300,000ms)

// --- 1. Send Push to a Specific Email ---
async function sendMobilePush(email, title, body) {
    db.all("SELECT subscription FROM user_subscriptions WHERE email = ?", [email], (err, rows) => {
        if (err || !rows) return;
        rows.forEach(row => {
            try {
                const sub = JSON.parse(row.subscription);
                webpush.sendNotification(sub, JSON.stringify({ title, body }))
                    .catch(() => {}); // Quietly handle expired tokens
            } catch (e) {}
        });
    });
}

// --- 2. Check Alerts ---
async function checkAlerts(currentPrices) {
    db.all("SELECT * FROM price_alerts WHERE is_active = 1", [], async (err, alerts) => {
        if (err || !alerts) return;
        for (const alert of alerts) {
            const livePrice = currentPrices[alert.ticker];
            if (!livePrice) continue;
            
            let triggered = (alert.condition === 'ABOVE' && livePrice >= alert.target_price) || 
                            (alert.condition === 'BELOW' && livePrice <= alert.target_price);
            
            if (triggered) {
                // Trigger the alert ONLY for the user's email
                await sendMobilePush(alert.email, `🚀 Alert: ${alert.ticker}`, `${alert.ticker} hit ${livePrice}!`);
                db.run("UPDATE price_alerts SET is_active = 0 WHERE id = ?", [alert.id]);
            }
        }
    });
}

// --- MAIN SCRAPER ENGINE ---
async function runScraper() {
    console.log(`[${new Date().toLocaleString()}] 🚀 INITIALIZING STEALTH BROWSER (One-time launch)...`);
    
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-dev-shm-usage'] 
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    const performScrape = async () => {
        try {
            console.log(`[${new Date().toLocaleString()}] 🔄 Scraping PSX Market...`);
            await page.goto('https://dps.psx.com.pk/market-watch', { waitUntil: 'networkidle', timeout: 60000 });
            await page.waitForSelector('table', { timeout: 20000 });

            const stocks = await page.evaluate(() => {
                const data = {};
                const rows = Array.from(document.querySelectorAll('table tr'));
                rows.forEach(row => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length >= 8) {
                        const ticker = cells[0].innerText.trim().split(/[\s-]/)[0].toUpperCase();
                        const price = parseFloat(cells[7].innerText.replace(/,/g, ''));
                        const ldcp = parseFloat(cells[3].innerText.replace(/,/g, ''));
                        if (ticker && !isNaN(price)) data[ticker] = { price, ldcp };
                    }
                });
                return data;
            });

            const tickers = Object.keys(stocks);
            if (tickers.length > 0) {
                const now = new Date().toISOString();
                db.serialize(() => {
                    db.run("BEGIN TRANSACTION");
                    const stmt = db.prepare("INSERT OR REPLACE INTO live_prices (ticker, price, ldcp, updated_at) VALUES (?, ?, ?, ?)");
                    tickers.forEach(t => stmt.run(t, stocks[t].price, stocks[t].ldcp, now));
                    stmt.finalize();
                    db.run("COMMIT");
                });
                console.log(`✅ Success! Updated ${tickers.length} stocks in database.`);
                
                const simplePriceMap = {};
                tickers.forEach(t => simplePriceMap[t] = stocks[t].price);
                await checkAlerts(simplePriceMap);
            }
        } catch (error) {
            console.error(`❌ Scrape Attempt Failed: ${error.message}`);
        }
        console.log(`😴 Waiting 5 minutes for next update...`);
    };

    // Run immediately on start
    await performScrape();

    // Then run every 5 minutes
    setInterval(performScrape, CHECK_INTERVAL);
}

runScraper().catch(err => {
    console.error("💥 FATAL SCRAPER ERROR:", err);
    process.exit(1);
});
