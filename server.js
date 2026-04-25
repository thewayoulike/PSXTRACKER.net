import express from 'express';
import sqlite3pkg from 'sqlite3';
import cors from 'cors';
import webpush from 'web-push';

const { Database } = sqlite3pkg;
const app = express();
const port = 3001; 

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 🛡️ Safety: Request Logger
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

const publicVapidKey = 'BOQirLyVkFOMp0DGyxgzq8oraIRq5FVopRlewMjLCn3VuIih8rak8BM_iiLCxIkMvDAoFlj8XulePa3RsByI6sQ';
const privateVapidKey = 'THsU_Jjbg6a1fv0Z3sNo4eRRIW5DQ3tAZnJdIw9_Wgo';
webpush.setVapidDetails('mailto:support@psxtracker.com', publicVapidKey, privateVapidKey);

const db = new Database('/var/www/psxtracker/psx_data.db', (err) => {
    if (err) console.error('❌ DB Error:', err.message);
    else {
        db.run("CREATE TABLE IF NOT EXISTS live_prices (ticker TEXT PRIMARY KEY, price REAL, ldcp REAL, updated_at TEXT)");
        db.run("CREATE TABLE IF NOT EXISTS user_data (email TEXT PRIMARY KEY, data TEXT)");
        db.run("CREATE TABLE IF NOT EXISTS push_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, subscription TEXT)");
    }
});

// --- ROUTES ---

// A. Load User Data
app.get(['/api/load/:email', '/load/:email'], (req, res) => {
    db.get("SELECT data FROM user_data WHERE email = ?", [req.params.email], (err, row) => {
        if (err) return res.status(500).json([]); // Return empty array on error
        if (row && row.data) {
            res.json(JSON.parse(row.data));
        } else {
            res.status(404).json({ transactions: [], portfolios: [] }); // Send valid empty structure
        }
    });
});

// B. Save User Data
app.post(['/api/save/:email', '/save/:email'], (req, res) => {
    db.run("INSERT INTO user_data (email, data) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET data = excluded.data",
        [req.params.email, JSON.stringify(req.body)],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// C. Save Push Subscription (FIXES THE 404 ERROR)
app.post(['/api/save-subscription', '/save-subscription'], (req, res) => {
    const subscription = JSON.stringify(req.body);
    db.run("INSERT INTO push_subscriptions (subscription) VALUES (?)", [subscription], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// D. Live Prices (With Date)
app.get(['/api/live-prices', '/live-prices'], (req, res) => {
    db.all("SELECT * FROM live_prices", [], (err, rows) => {
        if (err) return res.status(500).json({});
        const prices = {};
        rows.forEach(row => { 
            prices[row.ticker] = { price: row.price, ldcp: row.ldcp, date: row.updated_at }; 
        });
        res.json(prices);
    });
});

// E. Proxy & Quotes
app.get(['/api/proxy', '/proxy', '/api/quotes/:symbol/:range', '/quotes/:symbol/:range'], async (req, res) => {
    try {
        const url = req.params.symbol ? `https://dps.psx.com.pk/timeseries/eod/${req.params.symbol}` : req.query.url;
        const resp = await fetch(url);
        const data = await resp.text();
        res.send(data);
    } catch (err) { res.status(500).send(err.message); }
});

app.listen(port, '0.0.0.0', () => console.log(`🚀 API Server running on port ${port}`));
