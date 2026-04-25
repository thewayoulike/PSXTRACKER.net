import sqlite3pkg from 'sqlite3';

const { Database } = sqlite3pkg;
const DB_PATH = '/var/www/psxtracker/psx_data.db';

const db = new Database(DB_PATH, (err) => {
    if (err) console.error('❌ DB Error:', err.message);
});

// 1. Setup Separate Table for KSE100
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS kse100_history (
        date TEXT PRIMARY KEY,
        index_value REAL,
        prev_close REAL,
        change_percent REAL,
        volume INTEGER
    )`);
});

async function fetchKSE100() {
    const url = `https://dps.psx.com.pk/timeseries/eod/KSE100`;
    console.log(`[${new Date().toLocaleString()}] 🚀 Syncing KSE100 Index (30-Day History)...`);

    try {
        const response = await fetch(url);
        if (!response.ok) return;

        const json = await response.json();
        if (!json || !json.data || json.data.length < 2) return;

        // 2. Filter Weekdays and Sort Chronologically (Oldest to Newest)
        // Format: [timestamp, close_value, volume, open_value]
        const sortedData = json.data
            .map(entry => {
                const dateObj = new Date(entry[0] * 1000);
                return {
                    timestamp: entry[0],
                    close: entry[1],
                    volume: entry[2],
                    date: dateObj.toISOString().split('T')[0],
                    dayOfWeek: dateObj.getUTCDay() // 0=Sun, 6=Sat
                };
            })
            .filter(item => item.dayOfWeek !== 0 && item.dayOfWeek !== 6)
            .sort((a, b) => a.timestamp - b.timestamp);

        // 3. Derive True LDCP from the previous index close
        const recordsToInsert = [];
        for (let i = 1; i < sortedData.length; i++) {
            const current = sortedData[i];
            const yesterday = sortedData[i - 1];

            const ldcp = yesterday.close;
            let changePercent = 0;
            if (ldcp > 0) {
                changePercent = ((current.close - ldcp) / ldcp) * 100;
            }

            // Only process the last 40 days to ensure a solid 30-day trading window
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - 40);
            
            if (new Date(current.timestamp * 1000) >= cutoff) {
                recordsToInsert.push({
                    date: current.date,
                    index_value: current.close,
                    prev_close: ldcp,
                    change_percent: parseFloat(changePercent.toFixed(2)),
                    volume: current.volume
                });
            }
        }

        // 4. Update Database
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            const stmt = db.prepare(`
                INSERT INTO kse100_history (date, index_value, prev_close, change_percent, volume) 
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(date) DO UPDATE SET 
                index_value = excluded.index_value,
                prev_close = excluded.prev_close,
                change_percent = excluded.change_percent,
                volume = excluded.volume
            `);

            recordsToInsert.forEach(r => {
                stmt.run(r.date, r.index_value, r.prev_close, r.change_percent, r.volume);
            });

            stmt.finalize();
            db.run("COMMIT", () => {
                console.log(`✅ KSE100 Update Complete: ${recordsToInsert.length} days stored.`);
            });
        });

    } catch (e) {
        console.error(`❌ KSE100 Fetch Error:`, e.message);
    }
}

// Keep the table pruned to 45 days (buffer for long holidays)
function maintenance() {
    const d = new Date();
    d.setDate(d.getDate() - 45);
    const cutoffStr = d.toISOString().split('T')[0];
    db.run("DELETE FROM kse100_history WHERE date < ?", [cutoffStr]);
}

async function run() {
    maintenance();
    await fetchKSE100();
    // Close DB after a short delay to ensure transactions finish
    setTimeout(() => db.close(), 2000);
}

run();
