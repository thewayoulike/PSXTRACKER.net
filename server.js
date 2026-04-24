import express from 'express';
import sqlite3pkg from 'sqlite3';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import { exec } from 'child_process';
import cron from 'node-cron'; // <-- NEW: The background timer

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { Database } = sqlite3pkg;

const app = express();
const port = 3001;
app.use(bodyParser.json({ limit: '10mb' }));

const DB_PATH = '/var/www/psxtracker/psx_data.db';
const db = new Database(DB_PATH);

db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS user_data (email TEXT PRIMARY KEY, data TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS historical_prices (ticker TEXT, price REAL, date TEXT, PRIMARY KEY(ticker, date))");
    // NEW: Table to store the 24/7 live prices for your future notification system
    db.run("CREATE TABLE IF NOT EXISTS live_prices (ticker TEXT PRIMARY KEY, price REAL, updated_at TEXT)");
});

const cleanTicker = (rawName) => {
    if (!rawName) return "";
    let name = rawName.replace(/'/g, "").trim().toUpperCase();
    if (name.includes('-')) { name = name.split('-')[0]; }
    return name.trim();
};

const fetchKse100 = async () => {
    console.log("[SYNC] Fetching KSE100 Index...");
    try {
        const resp = await fetch('https://dps.psx.com.pk/timeseries/daily/KSE100', {
            headers: { 
                'User-Agent': 'Mozilla/5.0', 
                'Referer': 'https://dps.psx.com.pk/',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        const json = await resp.json();
        const dataRows = json.data || [];

        if (dataRows.length > 0) {
            const recent = dataRows.slice(-35);
            db.serialize(() => {
                db.run("BEGIN TRANSACTION");
                const stmt = db.prepare("INSERT OR REPLACE INTO historical_prices (ticker, price, date) VALUES (?, ?, ?)");
                recent.forEach(item => {
                    let ts = parseInt(item[0]);
                    if (ts > 10000000000) ts /= 1000;
                    const dateStr = new Date(ts * 1000).toISOString().split('T')[0];
                    const closePrice = parseFloat(item[4]);
                    if (!isNaN(closePrice)) stmt.run('KSE100', closePrice, dateStr);
                });
                stmt.finalize();
                db.run("COMMIT");
            });
        }
    } catch (e) { console.error("[ERROR] KSE100 Fetch failed:", e.message); }
};

const downloadAndParseZip = async (date) => {
    const ds = date.toISOString().split('T')[0];
    const url = `https://dps.psx.com.pk/download/symbol_price/${ds}.zip`;
    try {
        const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!resp.ok) return;
        const buffer = await resp.arrayBuffer();
        const zip = new AdmZip(Buffer.from(buffer));
        const entry = zip.getEntries()[0];
        if (entry) {
            const content = entry.getData().toString('utf8');
            const lines = content.split(/\r\n|\r|\n/);
            db.serialize(() => {
                db.run("BEGIN TRANSACTION");
                const stmt = db.prepare("INSERT OR REPLACE INTO historical_prices (ticker, price, date) VALUES (?, ?, ?)");
                for (let line of lines) {
                    const quoted = line.match(/'([^']+)'/g);
                    const numbers = line.match(/[\d.]+(?=\s*$)/);
                    if (quoted && quoted.length >= 2 && numbers) {
                        const ticker = cleanTicker(quoted[1]);
                        const price = parseFloat(numbers[0]);
                        if (ticker && !isNaN(price) && ticker !== "SYMBOL_CODE") { stmt.run(ticker, price, ds); }
                    }
                }
                stmt.finalize();
                db.run("COMMIT");
            });
        }
    } catch (e) {}
};

// --- ROUTES ---

app.get('/quotes/:symbol/:range', (req, res) => {
    const sym = cleanTicker(req.params.symbol);
    db.all("SELECT price, date FROM historical_prices WHERE ticker = ? ORDER BY date ASC", [sym], (err, rows) => {
        if (err) return res.status(500).json([]);
        res.json(rows.map(r => ({ time: new Date(r.date).getTime(), price: r.price })));
    });
});

app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send("No URL provided");
    try {
        const response = await fetch(targetUrl, { headers: { 'Referer': 'https://dps.psx.com.pk/' } });
        res.send(await response.text());
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/load/:email', (req, res) => {
    db.get("SELECT data FROM user_data WHERE email = ?", [req.params.email], (err, row) => {
        res.json({ success: true, data: row ? JSON.parse(row.data) : null });
    });
});

app.post('/save', (req, res) => {
    const { email, data } = req.body;
    db.run("INSERT INTO user_data (email, data) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET data = excluded.data", [email, JSON.stringify(data)], (err) => {
        res.json({ success: true });
    });
});

// --- SERVER STARTUP AND BACKGROUND WORKERS ---

const startServer = () => {
    app.listen(port, "0.0.0.0", async () => {
        console.log(`Backend Server running on port ${port}`);
        
        // 1. Initial Historical Data Fetch
        await fetchKse100();
        const today = new Date();
        for (let i = 0; i < 40; i++) {
            const d = new Date(); d.setDate(today.getDate() - i);
            await downloadAndParseZip(d);
        }

        // 2. Schedule Daily Historical Data Fetch (Every day at 5:00 PM PKT)
        cron.schedule('0 17 * * *', async () => {
            console.log("[CRON] Running daily historical zip fetch at 5:00 PM PKT");
            await fetchKse100();
            await downloadAndParseZip(new Date()); 
        }, { timezone: "Asia/Karachi" });

        // 3. NEW: Background Worker for Live Prices & Notifications (Every 3 minutes, Mon-Fri)
        cron.schedule('*/3 * * * 1-5', async () => {
            // Check exact PKT time to enforce 9:15 to 16:30 Market Hours
            const pkt = new Date().toLocaleString("en-US", { timeZone: "Asia/Karachi" });
            const date = new Date(pkt);
            const h = date.getHours();
            const m = date.getMinutes();
            
            // If market is closed, do nothing
            if (h < 9 || (h === 9 && m < 15) || h > 16 || (h === 16 && m > 30)) {
                return; 
            }

            console.log("[BACKGROUND] Fetching live market data (Ready for Notifications)...");
            
            try {
                // Here we fetch the data in the background
                const res = await fetch('https://dps.psx.com.pk/market-watch', { headers: { 'Referer': 'https://dps.psx.com.pk/' } });
                const html = await res.text();
                
                // LATER: This is exactly where you will add the code to:
                // 1. Parse the HTML for prices
                // 2. Save them to the 'live_prices' database table
                // 3. Check if any price dropped below a user's alert threshold
                // 4. Send the notification email/SMS!
                
            } catch (err) {
                console.error("[BACKGROUND] Failed to fetch live prices:", err.message);
            }
        }, { timezone: "Asia/Karachi" });

    });
};

exec(`fuser -k ${port}/tcp`, (err) => { startServer(); });
