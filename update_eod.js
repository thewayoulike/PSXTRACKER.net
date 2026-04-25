import AdmZip from 'adm-zip';
import sqlite3pkg from 'sqlite3';

const { Database } = sqlite3pkg;

// Connect to your existing SQLite database
const db = new Database('/var/www/psxtracker/psx_data.db', (err) => {
    if (err) {
        console.error('❌ DB Connection Error:', err.message);
        process.exit(1);
    }
});

// Initialize the End of Day (EOD) table
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS symbol_prices (
        date TEXT,
        market_code TEXT,
        symbol_code TEXT,
        symbol_name TEXT,
        settlement_type TEXT,
        upper_price REAL,
        lower_price REAL,
        close_price REAL,
        PRIMARY KEY (date, symbol_code)
    )`);
});

// Function to fetch and process a single day's data
async function downloadAndSaveEOD(dateString) {
    const url = `https://dps.psx.com.pk/download/symbol_price/${dateString}.zip`;
    console.log(`[${new Date().toLocaleString()}] ⏳ Fetching data for ${dateString}...`);

    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            console.log(`⏭️  Skipped ${dateString}: No file found (likely weekend/holiday).`);
            return;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const zip = new AdmZip(buffer);
        const zipEntries = zip.getEntries();
        const txtFileEntry = zipEntries.find(entry => entry.entryName.endsWith('.txt'));

        if (!txtFileEntry) {
            throw new Error("No text file found in the ZIP archive.");
        }

        // Get raw text
        const rawContent = txtFileEntry.getData().toString('utf8');
        
        // ---------------------------------------------------------
        // CUSTOM PSX PARSER (Replaces csv-parse to prevent errors)
        // ---------------------------------------------------------
        const lines = rawContent.split(/\r?\n/);
        const records = [];
        
        // Matches PSX specific format: 'REG','786','Name','READY',29.85,24.43,27.14
        const psxRegex = /^'([^']*)','([^']*)','(.*)','([^']*)',([^,]+),([^,]+),([^,]+)$/;

        for (let i = 1; i < lines.length; i++) { // Start at 1 to skip the header
            const line = lines[i].trim();
            if (!line) continue; // Skip empty lines
            
            const match = line.match(psxRegex);
            if (match) {
                records.push({
                    MARKET_CODE: match[1],
                    SYMBOL_CODE: match[2],
                    SYMBOL_NAME: match[3],
                    SETTLEMENT_TYPE: match[4],
                    ORDER_REJECT_UPPER_PRICE: parseFloat(match[5]) || 0,
                    ORDER_REJECT_LOWER_PRICE: parseFloat(match[6]) || 0,
                    LAST_DAY_CLOSE_PRICE: parseFloat(match[7]) || 0
                });
            }
        }

        console.log(`📝 Inserting ${records.length} records into database for ${dateString}...`);

        if (records.length === 0) {
             console.log(`⚠️  Warning: No valid records found to insert for ${dateString}.`);
             return;
        }

        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run("BEGIN TRANSACTION");
                const stmt = db.prepare(`
                    INSERT INTO symbol_prices 
                    (date, market_code, symbol_code, symbol_name, settlement_type, upper_price, lower_price, close_price) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(date, symbol_code) DO UPDATE SET 
                    upper_price = excluded.upper_price,
                    lower_price = excluded.lower_price,
                    close_price = excluded.close_price
                `);

                for (const r of records) {
                    stmt.run(
                        dateString,
                        r.MARKET_CODE,
                        r.SYMBOL_CODE,
                        r.SYMBOL_NAME,
                        r.SETTLEMENT_TYPE,
                        r.ORDER_REJECT_UPPER_PRICE,
                        r.ORDER_REJECT_LOWER_PRICE,
                        r.LAST_DAY_CLOSE_PRICE
                    );
                }

                stmt.finalize();
                db.run("COMMIT", (err) => {
                    if (err) {
                        console.error(`❌ Commit Error for ${dateString}:`, err.message);
                        reject(err);
                    } else {
                        console.log(`🎉 Successfully saved all data for ${dateString}!\n`);
                        resolve();
                    }
                });
            });
        });

    } catch (error) {
        console.error(`❌ Error processing data for ${dateString}:`, error.message);
    }
}

// Utility to get a formatted date string for "X days ago"
function getPastDateString(daysAgo) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// Main execution loop: Run sequentially backwards from today to 30 days ago
async function fetchLast30Days() {
    console.log("🚀 Starting bulk import for the last 30 days...\n");
    
    // Loop from 0 (today) down to 30 (30 days ago)
    for (let i = 0; i <= 30; i++) {
        const targetDate = getPastDateString(i);
        await downloadAndSaveEOD(targetDate);
        
        // Wait 1 second between requests to avoid spamming the PSX server
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log("🏁 Bulk import complete!");
    db.close(); // Close DB gracefully when everything is done
}

// Execute the script
fetchLast30Days();
