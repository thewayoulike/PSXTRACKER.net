import express from 'express';
import sqlite3pkg from 'sqlite3';
import cors from 'cors';
import webpush from 'web-push';

const { Database } = sqlite3pkg;
const app = express();
const port = 3001; 

// Allow cross-origin requests from your frontend
app.use(cors());
app.use(express.json({ limit: '10mb' })); 

// Request Logger (Helps debug if Nginx is sending traffic properly)
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] Incoming Request: ${req.method} ${req.url}`);
    next();
});

// --- 🔴 Push Notification Keys ---
const publicVapidKey = 'BOQirLyVkFOMp0DGyxgzq8oraIRq5FVopRlewMjLCn3VuIih8rak8BM_iiLCxIkMvDAoFlj8XulePa3RsByI6sQ';
const privateVapidKey = 'THsU_Jjbg6a1fv0Z3sNo4eRRIW5DQ3tAZnJdIw9_Wgo';
webpush.setVapidDetails('mailto:support@psxtracker.com', publicVapidKey, privateVapidKey);

// Use a local database file to avoid permission denial crashes
const db = new Database('./psx_data.db', (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to SQLite database.');
        // Ensure standard tables exist
        db.run("CREATE TABLE IF NOT EXISTS live_prices (ticker TEXT PRIMARY KEY, price REAL, ldcp REAL, updated_at TEXT)");
        db.run("CREATE TABLE IF NOT EXISTS push_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, subscription TEXT)");
        db.run("CREATE TABLE IF NOT EXISTS price_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT, target_price REAL, condition TEXT, user_id TEXT, is_active INTEGER DEFAULT 1)");
        db.run("CREATE TABLE IF NOT EXISTS user_profiles (email TEXT PRIMARY KEY, portfolio_data TEXT, updated_at TEXT)");
        
        // Ensure historical tables exist
        db.run(`CREATE TABLE IF NOT EXISTS historical_eod (ticker TEXT, date TEXT, close REAL, prev_close REAL, change_percent REAL, volume INTEGER, PRIMARY KEY (ticker, date))`);
        db.run(`CREATE TABLE IF NOT EXISTS kse100_history (date TEXT PRIMARY KEY, index_value REAL, prev_close REAL, change_percent REAL, volume INTEGER)`);
    }
});

// --- ROUTES ---

// Proxy Route for Frontend Scraper
app.get(['/api/proxy', '/proxy'], async (req, res) => {
    try {
        const targetUrl = req.query.url;
        if (!targetUrl) return res.status(400).send({ error: 'No URL provided' });
        const response = await fetch(targetUrl);
        const data = await response.text();
        res.send(data);
    } catch (err) {
        res.status(500).send({ error: 'Proxy fetch failed', message: err.message });
    }
});

// Fetch live prices
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

// Save mobile notification subscriptions
app.post(['/api/save-subscription', '/save-subscription'], (req, res) => {
    const subscription = JSON.stringify(req.body);
    db.run("INSERT INTO push_subscriptions (subscription) VALUES (?)", [subscription], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id: this.lastID });
    });
});

// Load User Portfolio Data
app.get(['/api/load/:email', '/load/:email'], (req, res) => {
    const email = req.params.email;
    db.get("SELECT portfolio_data FROM user_profiles WHERE email = ?", [email], (err, row) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (row && row.portfolio_data) {
            try { res.json(JSON.parse(row.portfolio_data)); } 
            catch (e) { res.status(500).json({ error: 'Corrupted data in DB' }); }
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    });
});

// Save User Portfolio Data
app.post(['/api/save/:email', '/save/:email'], (req, res) => {
    const email = req.params.email;
    const portfolioData = JSON.stringify(req.body);
    const updatedAt = new Date().toISOString();

    const query = `
        INSERT INTO user_profiles (email, portfolio_data, updated_at) 
        VALUES (?, ?, ?) 
        ON CONFLICT(email) DO UPDATE SET 
        portfolio_data = excluded.portfolio_data, 
        updated_at = excluded.updated_at
    `;
    db.run(query, [email, portfolioData, updatedAt], function(err) {
        if (err) return res.status(500).json({ error: 'Failed to save data' });
        res.json({ success: true, message: 'Data saved successfully' });
    });
});

// --- CHART ROUTES: Historical Data ---

// 1. KSE100 History Route
app.get(['/api/kse100-history', '/kse100-history'], (req, res) => {
    db.all("SELECT * FROM kse100_history ORDER BY date ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

// 2. Stock History Route
app.get(['/api/history/:ticker', '/history/:ticker'], (req, res) => {
    const ticker = req.params.ticker.toUpperCase();
    
    // Prevent dummy tickers like CASH from crashing or cluttering the logs
    if (['CASH', 'CGT'].includes(ticker)) return res.json([]);

    db.all(
        `SELECT date, close AS current_close, prev_close AS ldcp, change_percent, volume 
         FROM historical_eod 
         WHERE ticker = ? 
         ORDER BY date ASC`, 
        [ticker], 
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        }
    );
});

app.listen(port, () => {
    console.log(`✅ API Server running on http://localhost:${port}`);
});
