import express from 'express';
import sqlite3pkg from 'sqlite3';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Database } = sqlite3pkg;
const app = express();
const port = 3001;

app.use(bodyParser.json({ limit: '10mb' }));

// --- NATIVE FETCH PROXY (NO CLOUDSCRAPER NEEDED) ---
// Listening on both /proxy and /api/proxy to guarantee it catches the Nginx request
app.get(['/proxy', '/api/proxy'], async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send("No URL provided");
    
    try {
        console.log(`[API] Fetching: ${targetUrl}`);
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'max-age=0'
            }
        });
        
        const data = await response.text();
        res.send(data);
    } catch (error) {
        console.error("Proxy Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// 1. Database Connection
const dbPath = path.join(__dirname, 'psx_data.db');
const db = new Database(dbPath, (err) => {
    if (err) console.error("Database connection error:", err.message);
    else console.log("Database Connected: " + dbPath);
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS user_data (
        email TEXT PRIMARY KEY,
        data TEXT,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// 2. Dual Routes for Load / Save / Delete
app.get(['/load/:email', '/api/load/:email'], (req, res) => {
    db.get("SELECT data FROM user_data WHERE email = ?", [req.params.email], (err, row) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, data: row ? JSON.parse(row.data) : null });
    });
});

app.post(['/save', '/api/save'], (req, res) => {
    const { email, data } = req.body;
    if (!email || !data) return res.status(400).json({ success: false, message: "Missing data" });
    const query = `INSERT INTO user_data (email, data, last_updated) 
                   VALUES (?, ?, CURRENT_TIMESTAMP)
                   ON CONFLICT(email) DO UPDATE SET data = excluded.data, last_updated = CURRENT_TIMESTAMP`;
    db.run(query, [email, JSON.stringify(data)], (err) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, message: "Saved to VPS!" });
    });
});

app.delete(['/delete/:email', '/api/delete/:email'], (req, res) => {
    db.run(`DELETE FROM user_data WHERE email = ?`, [req.params.email], (err) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

app.listen(port, "0.0.0.0", () => console.log(`Backend listening on port ${port}`));
