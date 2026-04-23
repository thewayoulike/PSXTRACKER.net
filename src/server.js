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

// 1. Database Connection
const dbPath = path.join(__dirname, 'psx_data.db');
const db = new Database(dbPath, (err) => {
    if (err) console.error("Database connection error:", err.message);
    else console.log("Database Connected: " + dbPath);
});

// 2. Initialize Table
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS user_data (
        email TEXT PRIMARY KEY,
        data TEXT,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// 3. API: Load Data
app.get('/api/load/:email', (req, res) => {
    db.get("SELECT data FROM user_data WHERE email = ?", [req.params.email], (err, row) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, data: row ? JSON.parse(row.data) : null });
    });
});

// 4. API: Save Data
app.post('/api/save', (req, res) => {
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

// 5. API: Delete Data (Privacy Requirement)
app.delete('/api/delete/:email', (req, res) => {
    db.run(`DELETE FROM user_data WHERE email = ?`, [req.params.email], (err) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

app.listen(port, "0.0.0.0", () => console.log(`Backend listening on port ${port}`));
