import express from 'express';
import sqlite3pkg from 'sqlite3';
import cors from 'cors';
import webpush from 'web-push';

const { Database } = sqlite3pkg;
const app = express();
const port = 3001; 

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 🛡️ Request Logger & Safety Middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

const publicVapidKey = 'BOQirLyVkFOMp0DGyxgzq8oraIRq5FVopRlewMjLCn3VuIih8rak8BM_iiLCxIkMvDAoFlj8XulePa3RsByI6sQ';
const privateVapidKey = 'THsU_Jjbg6a1fv0Z3sNo4eRRIW5DQ3tAZnJdIw9_Wgo';
webpush.setVapidDetails('mailto:support@psxtracker.com', publicVapidKey, privateVapidKey);

// Use absolute path to ensure DB is found regardless of where you start the script
const db = new Database('/var/www/psxtracker/psx_data.db', (err) => {
    if (err) console.error('❌ DB Error:', err.message);
    else {
        console.log('✅ Connected to SQLite database.');
        db.run("CREATE TABLE IF NOT EXISTS live_prices (ticker TEXT PRIMARY KEY, price REAL, ldcp REAL, updated_at TEXT)");
        db.run("CREATE TABLE IF NOT EXISTS user_profiles (email TEXT PRIMARY KEY, portfolio_data TEXT, updated_at TEXT)");
    }
});

// 1. Proxy Route
app.get(['/api/proxy', '/proxy'], async (req, res) => {
    try {
        const response = await fetch(req.query.url);
        const data = await response.text();
        res.send(data);
    } catch (err) { res.status(500).send(err.message); }
});

// 2. Load User Portfolio
app.get(['/api/load/:email', '/load/:email'], (req, res) => {
    db.get("SELECT portfolio_data FROM user_profiles WHERE email = ?", [req.params.email], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) res.json(JSON.parse(row.portfolio_data));
        else res.status(404).json({ error: 'Not Found' });
    });
});

// 3. Save User Portfolio
app.post(['/api/save/:email', '/save/:email'], (req, res) => {
    const query = `INSERT INTO user_profiles (email, portfolio_data, updated_at) VALUES (?, ?, ?) 
                   ON CONFLICT(email) DO UPDATE SET portfolio_data=excluded.portfolio_data, updated_at=excluded.updated_at`;
    db.run(query, [req.params.email, JSON.stringify(req.body), new Date().toISOString()], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// 4. Live Prices
app.get(['/api/live-prices', '/live-prices'], (req, res) => {
    db.all("SELECT * FROM live_prices", [], (err, rows) => {
        const prices = {};
        rows?.forEach(r => prices[r.ticker] = { price: r.price, ldcp: r.ldcp });
        res.json(prices);
    });
});

// 5. Historical Quotes (The missing route causing the crash)
app.get(['/api/quotes/:symbol/:range', '/quotes/:symbol/:range'], async (req, res) => {
    try {
        const response = await fetch(`https://dps.psx.com.pk/timeseries/eod/${req.params.symbol}`);
        const data = await response.text();
        res.send(data);
    } catch (err) { res.status(500).send(err.message); }
});

// 🚀 Start Server
app.listen(port, () => console.log(`🚀 Server on port ${port}`));

// 🛑 Safety Catch for crashes
process.on('uncaughtException', (err) => console.error('CRASH PREVENTED:', err));
