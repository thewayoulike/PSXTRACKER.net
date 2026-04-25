import sqlite3pkg from 'sqlite3';

const { Database } = sqlite3pkg;
const DB_PATH = '/var/www/psxtracker/psx_data.db';

const db = new Database(DB_PATH, (err) => {
    if (err) console.error('❌ DB Error:', err.message);
});

// 1. Setup Table Schema
db.serialize(() => {
    // PRIMARY KEY on (ticker, date) prevents duplicates while keeping 30 days of history
    db.run(`CREATE TABLE IF NOT EXISTS historical_eod (
        ticker TEXT,
        date TEXT,
        close REAL,
        prev_close REAL,
        change_percent REAL,
        volume INTEGER,
        PRIMARY KEY (ticker, date)
    )`);
});

async function fetchAndStoreEOD(ticker) {
    const url = `https://dps.psx.com.pk/timeseries/eod/${ticker}`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) return;
        
        const json = await response.json();
        if (!json || !json.data || json.data.length < 2) return;

        // 2. Filter for Weekdays and Sort Ascending (Oldest to Newest)
        const processedData = json.data
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

        // 3. Process records to derive LDCP from the previous day's close
        const recordsToInsert = [];
        for (let i = 1; i < processedData.length; i++) {
            const current = processedData[i];
            const yesterday = processedData[i - 1];

            const ldcp = yesterday.close; // The true Last Day Close Price
            let changePercent = 0;
            if (ldcp > 0) {
                changePercent = ((current.close - ldcp) / ldcp) * 100;
            }

            // Only insert if the record is within the last 35 days (buffer for gaps)
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - 35);
            if (new Date(current.timestamp * 1000) >= cutoff) {
                recordsToInsert.push({
                    ticker: ticker,
                    date: current.date,
                    close: current.close,
                    prev_close: ldcp,
                    change_percent: parseFloat(changePercent.toFixed(2)),
                    volume: current.volume
                });
            }
        }

        // 4. Save to Database
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            const stmt = db.prepare(`
                INSERT INTO historical_eod (ticker, date, close, prev_close, change_percent, volume) 
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(ticker, date) DO UPDATE SET 
                close = excluded.close,
                prev_close = excluded.prev_close,
                change_percent = excluded.change_percent,
                volume = excluded.volume
            `);

            recordsToInsert.forEach(r => {
                stmt.run(r.ticker, r.date, r.close, r.prev_close, r.change_percent, r.volume);
            });

            stmt.finalize();
            db.run("COMMIT");
        });
        process.stdout.write(`✅ ${ticker} `);
    } catch (e) {
        console.error(`\n❌ Error fetching ${ticker}: ${e.message}`);
    }
}

async function startUpdate() {
    console.log(`[${new Date().toLocaleString()}] 🚀 Syncing Historical Data (Calculating LDCP)...`);

    // Fetch tickers from your existing tracking table
    db.all("SELECT ticker FROM live_prices", [], async (err, rows) => {
        if (err || !rows) return;

        for (const row of rows) {
            await fetchAndStoreEOD(row.ticker);
            // 150ms delay to play nice with PSX servers
            await new Promise(r => setTimeout(r, 150));
        }

        // Daily Maintenance: Clear anything older than 45 days
        const cleanupDate = new Date();
        cleanupDate.setDate(cleanupDate.getDate() - 45);
        const cutoffStr = cleanupDate.toISOString().split('T')[0];
        db.run("DELETE FROM historical_eod WHERE date < ?", [cutoffStr]);

        console.log("\n🏁 Data sync and 30-day maintenance complete.");
        db.close();
    });
}

startUpdate();
