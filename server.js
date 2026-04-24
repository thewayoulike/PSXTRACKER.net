import express from 'express';
import sqlite3pkg from 'sqlite3';
import bodyParser from 'body-parser';
import yahooFinancePkg from 'yahoo-finance2';

const yahooFinance = yahooFinancePkg.default || yahooFinancePkg;
const { Database } = sqlite3pkg;
const app = express();
const port = 3001;

app.use(bodyParser.json({ limit: '50mb' }));

const db = new Database('/var/www/psxtracker/psx_data.db');

db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS user_data (email TEXT PRIMARY KEY, data TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS historical_prices (ticker TEXT, price REAL, date TEXT, PRIMARY KEY(ticker, date))");
    db.run("CREATE TABLE IF NOT EXISTS live_prices (ticker TEXT PRIMARY KEY, price REAL, ldcp REAL, updated_at TEXT)");
});

const endpoints = ['', '/api'];

endpoints.forEach(prefix => {
    app.post(`${prefix}/bulk-prices`, (req, res) => {
        const { prices } = req.body;
        if (!prices) return res.status(400).json({ error: "No data" });
        const now = new Date().toISOString();
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            const stmt = db.prepare("INSERT OR REPLACE INTO live_prices (ticker, price, ldcp, updated_at) VALUES (?, ?, ?, ?)");
            Object.entries(prices).forEach(([ticker, data]) => {
                if (data && data.price) stmt.run(ticker.toUpperCase(), data.price, data.ldcp || 0, now);
            });
            stmt.finalize();
            db.run("COMMIT", (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, count: Object.keys(prices).length });
            });
        });
    });

    // 🔴 FIXED: Now sending the updated_at time to your website!
    app.get(`${prefix}/live-prices`, (req, res) => {
        db.all("SELECT ticker, price, ldcp, updated_at FROM live_prices", [], (err, rows) => {
            const map = {};
            if (rows) rows.forEach(r => { 
                map[r.ticker] = { price: r.price, ldcp: r.ldcp, updated_at: r.updated_at }; 
            });
            res.json(map);
        });
    });

    app.get(`${prefix}/proxy`, async (req, res) => {
        const targetUrl = req.query.url;
        if (!targetUrl) return res.status(400).send("No URL");
        try {
            const response = await fetch(targetUrl, { 
                headers: { 'Referer': 'https://dps.psx.com.pk/', 'User-Agent': 'Mozilla/5.0' } 
            });
            res.send(await response.text());
        } catch (e) { res.status(500).send(e.message); }
    });

    app.post(`${prefix}/save`, (req, res) => {
        db.run("INSERT INTO user_data (email, data) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET data = excluded.data", 
        [req.body.email, JSON.stringify(req.body.data)], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });

    app.get(`${prefix}/load/:email`, (req, res) => {
        db.get("SELECT data FROM user_data WHERE email = ?", [req.params.email], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, data: row ? JSON.parse(row.data) : null });
        });
    });
});

app.listen(port, "0.0.0.0", () => {
    console.log(`🚀 Node Backend is alive on port ${port}`);
});
