import express from 'express';
import sqlite3pkg from 'sqlite3';
import cors from 'cors';
import webpush from 'web-push';

const { Database } = sqlite3pkg;
const app = express();
const port = 3001; 

// 1. Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // High limit for large portfolio saves

// Request Logger (Helps debug Nginx traffic)
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// 2. VAPID Keys for Push Notifications
const publicVapidKey = 'BOQirLyVkFOMp0DGyxgzq8oraIRq5FVopRlewMjLCn3VuIih8rak8BM_iiLCxIkMvDAoFlj8XulePa3RsByI6sQ';
const privateVapidKey = 'THsU_Jjbg6a1fv0Z3sNo4eRRIW5DQ3tAZnJdIw9_Wgo';
webpush.setVapidDetails('mailto:support@psxtracker.com', publicVapidKey, privateVapidKey);

// 3. Database Initialization (Absolute Path)
const db = new Database('/var/www/psxtracker/psx_data.db', (err) => {
    if (err) {
        console.error('❌ Database error:', err.message);
    } else {
        console.log('✅ Connected to SQLite database.');
        // Initialize all required tables
        db.run("CREATE TABLE IF NOT EXISTS live_prices (ticker TEXT PRIMARY KEY, price REAL, ldcp REAL, updated_at TEXT)");
        db.run("CREATE TABLE IF NOT EXISTS push_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, subscription TEXT)");
        db.run("CREATE TABLE IF NOT EXISTS price_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT, target_price REAL, condition TEXT, user_id TEXT, is_active INTEGER DEFAULT 1)");
        db.run("CREATE TABLE IF NOT EXISTS user_profiles (email TEXT PRIMARY KEY, portfolio_data TEXT, updated_at TEXT)");
    }
});

// --- ROUTES ---

// A. Load User Portfolio
app.get(['/api/load/:email', '/load/:email'], (req, res) => {
    db.get("SELECT portfolio_data FROM user_profiles WHERE email = ?", [req.params.email], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row && row.portfolio_data) {
            res.json(JSON.parse(row.portfolio_data));
        } else {
            res.status(404).json({ error: "User not found" });
        }
    });
});

// B. Save User Portfolio
app.post(['/api/save/:email', '/save/:email'], (req, res) => {
    const query = `
        INSERT INTO user_profiles (email, portfolio_data, updated_at) 
        VALUES (?, ?, ?) 
        ON CONFLICT(email) DO UPDATE SET 
        portfolio_data = excluded.portfolio_data, 
        updated_at = excluded.updated_at
    `;
    db.run(query, [req.params.email, JSON.stringify(req.body), new Date().toISOString()], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// C. Delete User Data
app.delete(['/api/delete/:email', '/delete/:email'], (req, res) => {
    db.run("DELETE FROM user_profiles WHERE email = ?", [req.params.email], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// D. Market Data Proxy & Quotes (Fixes 404/502 errors on charts)
app.get(['/api/proxy', '/proxy', '/api/quotes/:symbol/:range', '/quotes/:symbol/:range'], async (req, res) => {
    try {
        // If symbol exists, it's a quote request; otherwise, it's a direct proxy URL
        const targetUrl = req.params.symbol 
            ? `https://dps.psx.com.pk/timeseries/eod/${req.params.symbol}`
            : req.query.url;

        if (!targetUrl) return res.status(400).json({ error: "No URL provided" });

        const response = await fetch(targetUrl);
        const data = await response.text();
        res.send(data);
    } catch (err) {
        console.error("Proxy failure:", err.message);
        res.status(500).send("Proxy error: " + err.message);
    }
});

// E. Live Price Feed
app.get(['/api/live-prices', '/live-prices'], (req, res) => {
    db.all("SELECT * FROM live_prices", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const prices = {};
        rows.forEach(row => { 
            prices[row.ticker] = { price: row.price, ldcp: row.ldcp, lastUpdated: row.updated_at }; 
        });
        res.json(prices);
    });
});

// F. Save Push Subscription
app.post(['/api/save-subscription', '/save-subscription'], (req, res) => {
    const subscription = JSON.stringify(req.body);
    db.run("INSERT INTO push_subscriptions (subscription) VALUES (?)", [subscription], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id: this.lastID });
    });
});

// --- CRITICAL SAFETY NET ---
// This prevents the server from dying (and causing 502 errors) if an unexpected error occurs
process.on('uncaughtException', (err) => {
    console.error('💥 CRASH PREVENTED:', err.message);
});

// 🚀 Start Server
app.listen(port, () => {
    console.log(`✅ API Server is alive on http://localhost:${port}`);
});
