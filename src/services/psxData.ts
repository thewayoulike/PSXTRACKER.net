import { SECTOR_CODE_MAP } from './sectors';

const TICKER_BLACKLIST = ['READY', 'FUTURE', 'OPEN', 'HIGH', 'LOW', 'CLOSE', 'VOLUME', 'CHANGE', 'SYMBOL', 'SCRIP', 'LDCP', 'MARKET', 'SUMMARY', 'CURRENT', 'SECTOR', 'LISTED IN'];

export type TimeRange = '1D' | '1M' | '6M' | 'YTD' | '1Y' | '3Y' | '5Y';

export const setScrapingApiKey = (key: string | null) => {};
export const setWebScrapingAIKey = (key: string | null) => {};

// --- SHARED VPS PROXY FETCH ---
const fetchUrlWithFallback = async (targetUrl: string): Promise<string | null> => {
    try {
        const proxyUrl = `/api/proxy?url=${encodeURIComponent(targetUrl)}`;
        const response = await fetch(proxyUrl);
        if (response.ok) {
            const text = await response.text();
            if (text && text.length > 100) {
                return text;
            }
        }
    } catch (e) {
        console.error("VPS API failed to fetch data.", e);
    }
    return null; 
};

// --- FETCH STOCK HISTORY ---
export const fetchStockHistory = async (symbol: string, range: TimeRange = '1D'): Promise<{ time: number; price: number }[]> => {
    const cleanSymbol = symbol.trim().toUpperCase();
    const targetUrl = `https://dps.psx.com.pk/timeseries/eod/${cleanSymbol}`;
    const htmlOrJson = await fetchUrlWithFallback(targetUrl);

    if (htmlOrJson) {
        try {
            const rawData = JSON.parse(htmlOrJson);
            if (rawData && rawData.data && Array.isArray(rawData.data)) {
                return rawData.data
                    .map((point: any[]) => ({ 
                        time: point[0] * 1000, 
                        price: Number(point[4]) 
                    }))
                    .sort((a: any, b: any) => a.time - b.time);
            }
        } catch (e) { }
    }
    return [];
};

// --- FETCH MARKET INDEX HISTORY ---
export const fetchIndexHistory = async (indexName: string = 'KSE100'): Promise<{ time: number; price: number }[]> => {
    const targetUrl = `https://dps.psx.com.pk/timeseries/eod/${indexName.toUpperCase()}`;
    const htmlOrJson = await fetchUrlWithFallback(targetUrl);

    if (htmlOrJson) {
        try {
            const rawData = JSON.parse(htmlOrJson);
            if (rawData && rawData.data && Array.isArray(rawData.data)) {
                return rawData.data
                    .map((point: any[]) => ({ 
                        time: point[0] * 1000, 
                        price: Number(point[4]) 
                    }))
                    .sort((a: any, b: any) => a.time - b.time);
            }
        } catch (e) {
            console.error(`Failed to parse history for ${indexName}`, e);
        }
    }
    return [];
};

// --- FETCH BATCH PRICES ---
export const fetchBatchPSXPrices = async (tickers: string[]): Promise<Record<string, { price: number, sector: string, ldcp: number, high: number, low: number, volume: number }>> => {
    const results: Record<string, any> = {};
    const targetTickers = new Set(tickers.map(t => t.trim().toUpperCase()));

    try {
        const res = await fetch('/api/live-prices');
        if (res.ok) {
            const liveDb = await res.json();
            let foundAny = false;
            
            targetTickers.forEach(ticker => {
                if (liveDb[ticker] && liveDb[ticker].price > 0) {
                    results[ticker] = {
                        price: liveDb[ticker].price,
                        ldcp: liveDb[ticker].ldcp || 0,
                        sector: SECTOR_CODE_MAP[ticker] || 'Unknown Sector',
                        high: liveDb[ticker].price,
                        low: liveDb[ticker].price,
                        volume: 0 
                    };
                    foundAny = true;
                }
            });
            if (foundAny) return results;
        }
    } catch (e) {
        console.warn("Local API fetch failed, trying proxy scraping...");
    }

    const html = await fetchUrlWithFallback(`https://dps.psx.com.pk/market-watch`);
    if (html && html.length > 500) {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const tables = doc.querySelectorAll("table");
            tables.forEach(table => {
                const rows = table.querySelectorAll("tr");
                if (rows.length < 2) return;

                let symbolIdx = 0, priceIdx = 5, ldcpIdx = 3; 
                const headerCells = rows[0].querySelectorAll("th, td");
                headerCells.forEach((cell, idx) => {
                    const txt = cell.textContent?.trim().toUpperCase() || "";
                    if (txt === 'SYMBOL') symbolIdx = idx;
                    if (txt.includes('CURRENT')) priceIdx = idx;
                    if (txt === 'LDCP') ldcpIdx = idx;
                });

                rows.forEach(row => {
                    const cols = row.querySelectorAll("td");
                    if (cols.length < 8) return;
                    const symbolText = cols[symbolIdx]?.textContent?.trim().toUpperCase() || "";
                    if (targetTickers.has(symbolText)) {
                        const price = parseFloat(cols[priceIdx]?.textContent?.trim().replace(/,/g, '') || '0');
                        if (price > 0) {
                            results[symbolText] = {
                                price,
                                ldcp: parseFloat(cols[ldcpIdx]?.textContent?.trim().replace(/,/g, '') || '0'),
                                sector: 'Scraped',
                                high: price, low: price, volume: 0
                            };
                        }
                    }
                });
            });
        } catch (e) { }
    }
    return results; 
};

// --- FETCH TOP VOLUME STOCKS ---
export const fetchTopVolumeStocks = async (): Promise<{ symbol: string; price: number; change: number; volume: number }[]> => {
    const html = await fetchUrlWithFallback(`https://dps.psx.com.pk/market-watch`);
    if (!html || html.length < 500) return [];
    
    const stocks: { symbol: string; price: number; change: number; volume: number }[] = [];
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const rows = doc.querySelectorAll("table tr");
        rows.forEach((row, rIdx) => {
            if (rIdx === 0) return; 
            const cols = row.querySelectorAll("td");
            if (cols.length < 8) return;
            const symbol = cols[0].textContent?.trim().split(/[\s-]/)[0].toUpperCase() || "";
            if (!symbol || TICKER_BLACKLIST.includes(symbol) || !isNaN(Number(symbol))) return;
            const price = parseFloat(cols[5]?.textContent?.trim().replace(/,/g, '') || '0');
            const change = parseFloat(cols[6]?.textContent?.trim().replace(/,/g, '') || '0');
            const volume = parseFloat(cols[7]?.textContent?.trim().replace(/,/g, '') || '0');
            if (price > 0 && volume > 0) stocks.push({ symbol, price, change, volume });
        });
        return stocks.sort((a, b) => b.volume - a.volume).slice(0, 20);
    } catch (e) { return []; }
};

// --- FETCH ALL SYMBOLS ---
export const fetchAllPSXSymbols = async (): Promise<{ symbols: string[], sectors: Record<string, string> }> => {
    const symbols = new Set<string>();
    const sectorsMap: Record<string, string> = {};
    try {
        const html = await fetchUrlWithFallback(`https://dps.psx.com.pk/market-watch`);
        if (html && html.length > 500) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const tables = doc.querySelectorAll("table");
            tables.forEach(table => {
                const rows = table.querySelectorAll("tr");
                let currentGroupHeader = "Unknown Sector";
                rows.forEach((row, rIdx) => {
                    const cells = row.querySelectorAll("td, th");
                    if (cells.length === 1) {
                        currentGroupHeader = cells[0].textContent?.trim() || currentGroupHeader;
                        return;
                    }
                    if (cells.length > 5) {
                        const symbol = cells[0].textContent?.trim().split(/[\s-]/)[0].toUpperCase();
                        if (symbol && !TICKER_BLACKLIST.includes(symbol)) {
                            symbols.add(symbol);
                            sectorsMap[symbol] = SECTOR_CODE_MAP[currentGroupHeader.toUpperCase()] || currentGroupHeader;
                        }
                    }
                });
            });
        }
    } catch (e) { }
    return { symbols: Array.from(symbols).sort(), sectors: sectorsMap };
};
