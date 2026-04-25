import PDFParser from 'pdf2json';
import sqlite3pkg from 'sqlite3';

const { Database } = sqlite3pkg;

// 1. Connect to your existing project database
const db = new Database('/var/www/psxtracker/psx_data.db', (err) => {
    if (err) {
        console.error('❌ DB Connection Error:', err.message);
        process.exit(1);
    }
});

// 2. Setup the table structure
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS pdf_closing_rates (
        date TEXT,
        ticker TEXT,
        prv_rate REAL,
        last_rate REAL,
        change_percent REAL,
        PRIMARY KEY (date, ticker)
    )`);
});

async function processDailyPDF(dateString) {
    const url = `https://dps.psx.com.pk/download/closing_rates/${dateString}.pdf`;
    console.log(`[${new Date().toLocaleString()}] ⏳ Fetching: ${url}`);

    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.log(`⏭️  No data for ${dateString} (Weekend or Holiday).`);
            return;
        }

        const buffer = Buffer.from(await response.arrayBuffer());

        return new Promise((resolve) => {
            const pdfParser = new PDFParser();
            pdfParser.on("pdfParser_dataError", () => resolve());
            pdfParser.on("pdfParser_dataReady", (pdfData) => {
                const records = [];

                pdfData.Pages.forEach(page => {
                    const lineMap = {};
                    page.Texts.forEach(text => {
                        const y = text.y;
                        if (!lineMap[y]) lineMap[y] = [];
                        lineMap[y].push(text);
                    });

                    Object.keys(lineMap).sort((a, b) => a - b).forEach(y => {
                        const items = lineMap[y]
                            .sort((a, b) => a.x - b.x)
                            .map(t => decodeURIComponent(t.R[0].T).trim())
                            .filter(t => t !== "");

                        // Standard PSX PDF row detection
                        if (items.length >= 7) {
                            const ticker = items[0].toUpperCase();
                            
                            // Skip headers and long text strings
                            if (["SYMBOL", "PAGE", "COMPANY"].includes(ticker) || ticker.includes("PAKISTAN")) return;

                            // Extract rates from the end of the reconstructed row
                            const prvStr = items[items.length - 6];
                            const lastStr = items[items.length - 2];

                            const prvRate = prvStr === '-' ? 0 : parseFloat(prvStr.replace(/,/g, ''));
                            const lastRate = lastStr === '-' ? 0 : parseFloat(lastStr.replace(/,/g, ''));

                            if (!isNaN(prvRate) && !isNaN(lastRate) && ticker.length >= 2 && ticker.length <= 10) {
                                // Calculate Percentage Change: ((Last - Prev) / Prev) * 100
                                let changePercent = prvRate > 0 ? ((lastRate - prvRate) / prvRate) * 100 : 0;

                                records.push({
                                    ticker,
                                    prv_rate: prvRate,
                                    last_rate: lastRate,
                                    change_percent: parseFloat(changePercent.toFixed(2))
                                });
                            }
                        }
                    });
                });

                if (records.length === 0) return resolve();

                db.serialize(() => {
                    db.run("BEGIN TRANSACTION");
                    const stmt = db.prepare(`
                        INSERT INTO pdf_closing_rates (date, ticker, prv_rate, last_rate, change_percent) 
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(date, ticker) DO UPDATE SET 
                        prv_rate = excluded.prv_rate,
                        last_rate = excluded.last_rate,
                        change_percent = excluded.change_percent
                    `);

                    records.forEach(r => stmt.run(dateString, r.ticker, r.prv_rate, r.last_rate, r.change_percent));
                    stmt.finalize();
                    db.run("COMMIT", () => {
                        console.log(`✅ Saved ${records.length} tickers for ${dateString}.`);
                        resolve();
                    });
                });
            });
            pdfParser.parseBuffer(buffer);
        });
    } catch (e) { console.error(`❌ Error: ${e.message}`); }
}

// Maintenance: Keep only last 30 days
function cleanupOldData() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];
    
    db.run(`DELETE FROM pdf_closing_rates WHERE date < ?`, [cutoffStr], function(err) {
        if (!err) console.log(`🧹 Cleanup: Removed records older than ${cutoffStr}.`);
    });
}

// Run Process
async function start() {
    cleanupOldData();
    for (let i = 0; i <= 30; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        await processDailyPDF(d.toISOString().split('T')[0]);
        await new Promise(r => setTimeout(r, 1000));
    }
    db.close();
    console.log("🏁 All data added to database.");
}

start();
