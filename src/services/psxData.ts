import { SECTOR_CODE_MAP } from './sectors';

const TICKER_BLACKLIST = ['READY', 'FUTURE', 'OPEN', 'HIGH', 'LOW', 'CLOSE', 'VOLUME', 'CHANGE', 'SYMBOL', 'SCRIP', 'LDCP', 'MARKET', 'SUMMARY', 'CURRENT', 'SECTOR', 'LISTED IN'];

export type TimeRange = '1D' | '1M' | '6M' | 'YTD' | '1Y' | '3Y' | '5Y';

export const setScrapingApiKey = (key: string | null) => {};
export const setWebScrapingAIKey = (key: string | null) => {};

// --- STRICTLY USES YOUR VPS API ONLY ---
const fetchUrlWithFallback = async (targetUrl: string): Promise<string | null> => {
    try {
        const proxyUrl = `/api/proxy?url=${encodeURIComponent(targetUrl)}`;
        const response = await fetch(proxyUrl);
        if (response.ok) {
            const text = await response.text();
            if (text && text.length > 500 && text.includes('<table')) {
                return text;
            } else if (text && text.length > 100 && (text.includes('"data":') || text.includes('[[') || text.includes('history'))) {
                // Allow JSON data to pass through for Timeseries (History) endpoints
                return text;
            }
        }
    } catch (e) {
        console.error("Your VPS API failed to fetch data.", e);
    }
    return null; 
};

const fetchLivePriceData = async (symbol: string): Promise<{ time: number; price: number } | null> => {
    try {
        const data = await fetchBatchPSXPrices([symbol]);
        const stock = data[symbol];
        if (stock && stock.price > 0) return { time: Date.now(), price: stock.price };
    } catch (e) { }
    return null;
};

// --- FETCH STOCK HISTORY ---
export const fetchStockHistory = async (symbol: string, range: TimeRange = '1D'): Promise<{ time: number; price: number }[]> => {
    const cleanSymbol = symbol.toUpperCase().replace('PSX:', '').trim();
    if (range === '1D') {
        const live = await fetchLivePriceData(cleanSymbol);
        return live ? [live] : [];
    }

    const targetUrl = `https://dps.psx.com.pk/timeseries/eod/${cleanSymbol}`;
    const htmlOrJson = await fetchUrlWithFallback(targetUrl);

    if (htmlOrJson) {
        try {
            const rawData = JSON.parse(htmlOrJson);
            if (rawData && rawData.data && Array.isArray(rawData.data)) {
                return rawData.data
                    .map((point: any[]) => ({ time: point[0] * 1000, price: Number(point[4]) }))
                    .sort((a: any, b: any) => a.time - b.time);
            }
        } catch (e) { }
    }

    const liveCandle = await fetchLivePriceData(cleanSymbol);
    return liveCandle ? [liveCandle] : [];
};

// --- NEW: FETCH MARKET INDEX HISTORY (KSE-100) ---
export const fetchIndexHistory = async (indexName: string = 'KSE100'): Promise<{ time: number; price: number }[]> => {
    const targetUrl = `https://dps.psx.com.pk/timeseries/eod/${indexName.toUpperCase()}`;
    const htmlOrJson = await fetchUrlWithFallback(targetUrl);

    if (htmlOrJson) {
        try {
            const rawData = JSON.parse(htmlOrJson);
            if (rawData && rawData.data && Array.isArray(rawData.data)) {
                return rawData.data
                    .map((point: any[]) => ({ time: point[0] * 1000, price: Number(point[4]) }))
                    .sort((a: any, b: any) => a.time - b.time);
            }
        } catch (e) {
            console.error(`Failed to parse history for ${indexName}`, e);
        }
    }
    return [];
};

export const fetchBatchPSXPrices = async (tickers: string[]): Promise<Record<string, { price: number, sector: string, ldcp: number, high: number, low: number, volume: number }>> => {
    const results: Record<string, any> = {};
    const targetUrl = `https://dps.psx.com.pk/market-watch`;
    const targetTickers = new Set(tickers.map(t => t.trim().toUpperCase()));
    const html = await fetchUrlWithFallback(targetUrl);

    if (html && html.length > 500) {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const tables = doc.querySelectorAll("table");
            if (tables.length === 0) return results;

            tables.forEach(table => {
                const rows = table.querySelectorAll("tr");
                if (rows.length < 2) return;

                const colMap = { SYMBOL: -1, PRICE: -1, SECTOR: -1, LDCP: -1, HIGH: -1, LOW: -1, VOLUME: -1 };
                const cells = rows[0].querySelectorAll("th, td");
                cells.forEach((cell, idx) => {
                    const txt = cell.textContent?.trim().toUpperCase() || "";
                    if (txt === 'SYMBOL' || txt === 'SCRIP') colMap.SYMBOL = idx;
                    if (txt.includes('CURRENT') || txt === 'PRICE' || txt === 'RATE') colMap.PRICE = idx;
                    if (txt === 'SECTOR') colMap.SECTOR = idx;
                    if (txt === 'LDCP' || txt === 'PREV') colMap.LDCP = idx;
                    if (txt === 'HIGH') colMap.HIGH = idx;
                    if (txt === 'LOW') colMap.LOW = idx;
                    if (txt.includes('VOL')) colMap.VOLUME = idx;
                });

                if (colMap.SYMBOL === -1) { 
                    colMap.SYMBOL = 0; colMap.SECTOR = 1; colMap.LDCP = 1; colMap.HIGH = 3; colMap.LOW = 4; colMap.PRICE = 5; colMap.VOLUME = 7; 
                }

                let currentGroupHeader = "Unknown Sector";

                rows.forEach(row => {
                    const cols = row.querySelectorAll("td");
                    if (cols.length === 1 || (cols.length > 0 && cols.length < 4)) {
                        const text = cols[0]?.textContent?.trim();
                        if (text && text.length > 3 && !TICKER_BLACKLIST.includes(text.toUpperCase())) currentGroupHeader = text;
                        return; 
                    }

                    if (!cols[colMap.SYMBOL] || !cols[colMap.PRICE]) return;

                    const symCell = cols[colMap.SYMBOL];
                    let symbolText = symCell.querySelector('a')?.textContent?.trim().toUpperCase() || "";
                    if (!symbolText) symbolText = symCell.textContent?.trim().toUpperCase() || "";
                    
                    let matchedTicker = null;
                    for (const ticker of targetTickers) { 
                        if (symbolText === ticker || symbolText.startsWith(ticker + ' ')) { matchedTicker = ticker; break; } 
                    }
                    if (!matchedTicker) return;

                    const getVal = (idx: number) => {
                        if (idx === -1 || !cols[idx]) return 0;
                        const val = parseFloat(cols[idx].textContent?.trim().replace(/,/g, '') || '0');
                        return isNaN(val) ? 0 : val;
                    };

                    const price = getVal(colMap.PRICE);
                    let sectorText = currentGroupHeader;
                    if (colMap.SECTOR !== -1 && cols[colMap.SECTOR]) {
                        const colText = cols[colMap.SECTOR].textContent?.trim();
                        if (colText) sectorText = colText;
                    }

                    if (price > 0) { 
                        results[matchedTicker] = { price, sector: SECTOR_CODE_MAP[sectorText.toUpperCase()] || sectorText, ldcp: colMap.LDCP !== -1 ? getVal(colMap.LDCP) : 0, high: colMap.HIGH !== -1 ? getVal(colMap.HIGH) : price, low: colMap.LOW !== -1 ? getVal(colMap.LOW) : price, volume: colMap.VOLUME !== -1 ? getVal(colMap.VOLUME) : 0 }; 
                    }
                });
            });
        } catch (e) { }
    }
    return results; 
};

export const fetchTopVolumeStocks = async (): Promise<{ symbol: string; price: number; change: number; volume: number }[]> => {
    // ... [Code omitted for brevity, keep your existing fetchTopVolumeStocks here] ...
    return [];
};

export const fetchAllPSXSymbols = async (): Promise<{ symbols: string[], sectors: Record<string, string> }> => {
    // ... [Code omitted for brevity, keep your existing fetchAllPSXSymbols here] ...
    return { symbols: [], sectors: {} };
};
