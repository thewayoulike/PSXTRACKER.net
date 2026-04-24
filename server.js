import express from 'express';
import sqlite3pkg from 'sqlite3';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import { exec } from 'child_process';
import cron from 'node-cron';

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
    db.run("CREATE TABLE IF NOT EXISTS live_prices (ticker TEXT PRIMARY KEY, price REAL, updated_at TEXT)");
});

const cleanTicker = (rawName) => {
    if (!rawName) return "";
    let name = rawName.replace(/'/g, "").trim().toUpperCase();
    if (name.includes('-')) { name = name.split('-')[0]; }
    return name.trim();
};

// --- FIX: FETCH KSE100 FROM YAHOO FINANCE INSTEAD OF DEAD PSX API ---
const fetchKse100 = async () => {
    console.log("[SYNC] Fetching KSE100 Index from Yahoo Finance...");
    try {
        const resp = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EKSE?interval=1d&range=3mo', {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const json = await resp.json();
        const result = json.chart.result[0];
        const timestamps = result.timestamp;
        const closes = result.indicators.quote[0].close;

        if (timestamps && timestamps.length > 0) {
            db.serialize(() => {
                db.run("BEGIN TRANSACTION");
                const stmt = db.prepare("INSERT OR REPLACE INTO historical_prices (ticker, price, date) VALUES (?, ?, ?)");
                for (let i = 0; i < timestamps.length; i++) {
                    if (closes[i] !== null && !isNaN(closes[i])) {
                        const dateStr = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
                        stmt.run('KSE100', closes[i], dateStr);
                    }
                }
                stmt.finalize();
                db.run("COMMIT", (err) => { if (!err) console.log(`[OK] KSE100 updated from Yahoo Finance.`); });
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
        
        await fetchKse100();
        const today = new Date();
        for (let i = 0; i < 40; i++) {
            const d = new Date(); d.setDate(today.getDate() - i);
            await downloadAndParseZip(d);
        }

        cron.schedule('0 17 * * *', async () => {
            console.log("[CRON] Running daily historical zip fetch at 5:00 PM PKT");
            await fetchKse100();
            await downloadAndParseZip(new Date()); 
        }, { timezone: "Asia/Karachi" });

        cron.schedule('*/3 * * * 1-5', async () => {
            const pkt = new Date().toLocaleString("en-US", { timeZone: "Asia/Karachi" });
            const date = new Date(pkt);
            const h = date.getHours();
            const m = date.getMinutes();
            if (h < 9 || (h === 9 && m < 15) || h > 16 || (h === 16 && m > 30)) { return; }
            
            console.log("[BACKGROUND] Fetching live market data (Ready for Notifications)...");
            try {
                const res = await fetch('https://dps.psx.com.pk/market-watch', { headers: { 'Referer': 'https://dps.psx.com.pk/' } });
                const html = await res.text();
            } catch (err) { console.error("[BACKGROUND] Failed to fetch live prices:", err.message); }
        }, { timezone: "Asia/Karachi" });

    });
};

exec(`fuser -k ${port}/tcp`, (err) => { startServer(); });
