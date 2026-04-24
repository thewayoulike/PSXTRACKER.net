import sqlite3pkg from 'sqlite3';
const { Database } = sqlite3pkg;

const DB_PATH = '/var/www/psxtracker/psx_data.db';
const db = new Database(DB_PATH);

async function inject() {
    console.log("Fetching KSE100 specifically...");
    try {
        const resp = await fetch('https://dps.psx.com.pk/timeseries/daily/KSE100', {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const json = await resp.json();
        const rows = json.data || [];

        if (rows.length > 0) {
            const last30 = rows.slice(-30);
            db.serialize(() => {
                db.run("BEGIN TRANSACTION");
                const stmt = db.prepare("INSERT OR REPLACE INTO historical_prices (ticker, price, date) VALUES (?, ?, ?)");
                
                last30.forEach(item => {
                    let ts = parseInt(item[0]);
                    if (ts > 10000000000) ts /= 1000;
                    const dateStr = new Date(ts * 1000).toISOString().split('T')[0];
                    const price = parseFloat(item[4]);
                    
                    console.log(`Injecting: KSE100 | ${dateStr} | ${price}`);
                    stmt.run('KSE100', price, dateStr);
                });

                stmt.finalize();
                db.run("COMMIT", (err) => {
                    if (err) console.error("Error:", err);
                    else console.log("SUCCESS: KSE100 is now in the database.");
                    process.exit();
                });
            });
        }
    } catch (e) {
        console.error("Failed:", e.message);
        process.exit(1);
    }
}
inject();
