import express from 'express';
import sqlite3pkg from 'sqlite3';
import cors from 'cors';
import webpush from 'web-push';

const { Database } = sqlite3pkg;
const app = express();
const port = 3001; 

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 🛡️ Safety Catch
process.on('uncaughtException', (err) => console.error('💥 Server error:', err.message));

// Push Notification Keys
const publicVapidKey = 'BOQirLyVkFOMp0DGyxgzq8oraIRq5FVopRlewMjLCn3VuIih8rak8BM_iiLCxIkMvDAoFlj8XulePa3RsByI6sQ';
const privateVapidKey = 'THsU_Jjbg6a1fv0Z3sNo4eRRIW5DQ3tAZnJdIw9_Wgo';
webpush.setVapidDetails('mailto:support@psxtracker.com', publicVapidKey, privateVapidKey);

// --- DATABASE SETUP (MULTI-USER UPDATE) ---
const db = new Database('/var/www/psxtracker/psx_data.db', (err) => {
    if (err) console.error('❌ DB Error:', err.message);
    else {
        db.run("CREATE TABLE IF NOT EXISTS live_prices (ticker TEXT PRIMARY KEY, price REAL, ldcp REAL, updated_at TEXT)");
        db.run("CREATE TABLE IF NOT EXISTS user_data (email TEXT PRIMARY KEY, data TEXT)");
        
        // Multi-user Notification Tables
        db.run("CREATE TABLE IF NOT EXISTS user_subscriptions (email TEXT PRIMARY KEY, subscription TEXT)");
        db.run("CREATE TABLE IF NOT EXISTS price_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, ticker TEXT, target_price REAL, condition TEXT, is_active INTEGER DEFAULT 1)");
    }
});

// --- ROUTES ---

// A. Load User Data
app.get(['/api/load/:email', '/load/:email'], (req, res) => {
    db.get("SELECT data FROM user_data WHERE email = ?", [req.params.email], (err, row) => {
        if (err) return res.status(500).json({ transactions: [], portfolios: [] });
        if (row && row.data) {
            try {
                res.json(JSON.parse(row.data));
            } catch (e) {
                res.json({ transactions: [], portfolios: [] });
            }
        } else {
            res.json({ transactions: [], portfolios: [] });
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

// C. Save Push Subscription (MULTI-USER FIX)
app.post(['/api/save-subscription', '/save-subscription'], (req, res) => {
    const { email, subscription } = req.body;
    
    if (!email || !subscription) {
        return res.status(400).json({ error: "Missing email or subscription data" });
    }

    db.run("INSERT INTO user_subscriptions (email, subscription) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET subscription = excluded.subscription", 
        [email, JSON.stringify(subscription)], 
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
    });
});

// D. Live Prices
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

// F. Delete User
app.delete(['/api/delete/:email', '/delete/:email'], (req, res) => {
    db.run("DELETE FROM user_data WHERE email = ?", [req.params.email], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        // Also delete their alerts and subscriptions
        db.run("DELETE FROM price_alerts WHERE email = ?", [req.params.email]);
        db.run("DELETE FROM user_subscriptions WHERE email = ?", [req.params.email]);
        res.json({ success: true });
    });
});

app.listen(port, '0.0.0.0', () => console.log(`🚀 API Server running on port ${port}`));
