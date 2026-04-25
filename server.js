import express from 'express';
import sqlite3pkg from 'sqlite3';
import cors from 'cors';
import webpush from 'web-push';

const { Database } = sqlite3pkg;
const app = express();
const port = 3001; 

app.use(cors());
app.use(express.json());

// --- 🔴 PASTE YOUR KEYS HERE ---
const publicVapidKey = 'BOQirLyVkFOMp0DGyxgzq8oraIRq5FVopRlewMjLCn3VuIih8rak8BM_iiLCxIkMvDAoFlj8XulePa3RsByI6sQ';
const privateVapidKey = 'THsU_Jjbg6a1fv0Z3sNo4eRRIW5DQ3tAZnJdIw9_Wgo';
// --------------------------------

webpush.setVapidDetails('mailto:support@psxtracker.com', publicVapidKey, privateVapidKey);

const db = new Database('/var/www/psxtracker/psx_data.db', (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to SQLite database.');
        // Ensure tables exist for alerts and subscriptions
        db.run("CREATE TABLE IF NOT EXISTS live_prices (ticker TEXT PRIMARY KEY, price REAL, ldcp REAL, updated_at TEXT)");
        db.run("CREATE TABLE IF NOT EXISTS push_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, subscription TEXT)");
        db.run("CREATE TABLE IF NOT EXISTS price_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT, target_price REAL, condition TEXT, user_id TEXT, is_active INTEGER DEFAULT 1)");
    }
});

// Existing route: Fetch live prices
app.get('/api/live-prices', (req, res) => {
    db.all("SELECT * FROM live_prices", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const prices = {};
        rows.forEach(row => { prices[row.ticker] = { price: row.price, ldcp: row.ldcp, lastUpdated: row.updated_at }; });
        res.json(prices);
    });
});

// NEW Route: Save mobile notification subscriptions
app.post('/api/save-subscription', (req, res) => {
    const subscription = JSON.stringify(req.body);
    db.run("INSERT INTO push_subscriptions (subscription) VALUES (?)", [subscription], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id: this.lastID });
    });
});

app.listen(port, () => {
    console.log(`API Server running on port ${port}`);
}); 
