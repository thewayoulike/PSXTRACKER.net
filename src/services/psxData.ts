import { SECTOR_CODE_MAP } from './sectors';

const TICKER_BLACKLIST = ['READY', 'FUTURE', 'OPEN', 'HIGH', 'LOW', 'CLOSE', 'VOLUME', 'CHANGE', 'SYMBOL', 'SCRIP', 'LDCP', 'MARKET', 'SUMMARY', 'CURRENT', 'SECTOR', 'LISTED IN'];

export type TimeRange = '1D' | '1M' | '6M' | 'YTD' | '1Y' | '3Y' | '5Y';

let userScrapingKey: string | null = null;      
let userWebScrapingAIKey: string | null = null; 

export const setScrapingApiKey = (key: string | null) => { userScrapingKey = key ? key.trim() : null; };
export const setWebScrapingAIKey = (key: string | null) => { userWebScrapingAIKey = key ? key.trim() : null; };

const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeout = 10000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
};

const fetchUrlWithFallback = async (targetUrl: string): Promise<string | null> => {
    // 1. TRY YOUR PRIVATE VPS PROXY FIRST (No CORS, Ultra-fast)
    try {
        const proxyUrl = `/api/proxy?url=${encodeURIComponent(targetUrl)}`;
        const response = await fetchWithTimeout(proxyUrl, {}, 8000); 
        if (response.ok) {
            const text = await response.text();
            if (text && text.length > 500) return text;
        }
    } catch (e) {
        console.warn("VPS Proxy failed, falling back to APIs...");
    }

    // 2. FALLBACK: Scrape.do
    if (userScrapingKey) {
        try {
            const premiumUrl = `http://api.scrape.do?token=${userScrapingKey}&url=${encodeURIComponent(targetUrl)}`;
            const response = await fetchWithTimeout(premiumUrl, {}, 25000);
            if (response.ok) return await response.text();
        } catch (e) { }
    }

    // 3. FALLBACK: WebScraping.AI
    if (userWebScrapingAIKey) {
        try {
            const wsUrl = `https://api.webscraping.ai/html?api_key=${userWebScrapingAIKey}&url=${encodeURIComponent(targetUrl)}`;
            const response = await fetchWithTimeout(wsUrl, {}, 25000);
            if (response.ok) return await response.text();
        } catch (e) { }
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

export const fetchBatchPSXPrices = async (tickers: string[]): Promise<Record<string, { price: number, sector: string, ldcp: number, high: number, low: number, volume: number }>> => {
    const results: Record<string, any> = {};
    const targetUrl = `https://dps.psx.com.pk/market-watch`;
    const targetTickers = new Set(tickers.map(t => t.trim().toUpperCase()));
    const html = await fetchUrlWithFallback(targetUrl);

    if (html && html.length > 500) {
        parseMarketWatchTable(html, results, targetTickers);
    }
    return results; 
};

export const fetchTopVolumeStocks = async (): Promise<{ symbol: string; price: number; change: number; volume: number }[]> => {
    const targetUrl = `https://dps.psx.com.pk/market-watch`;
    const html = await fetchUrlWithFallback(targetUrl);

    if (!html || html.length < 500) return [];
    const stocks: { symbol: string; price: number; change: number; volume: number }[] = [];
    
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const tables = doc.querySelectorAll("table");

        tables.forEach(table => {
            const rows = table.querySelectorAll("tr");
            if (rows.length < 2) return;
            
            const headerCells = rows[0].querySelectorAll("th, td");
            const colMap = { SYMBOL: -1, PRICE: -1, CHANGE: -1, VOLUME: -1 };

            headerCells.forEach((cell, idx) => {
                const txt = cell.textContent?.trim().toUpperCase() || "";
                if (txt === 'SYMBOL' || txt === 'SCRIP') colMap.SYMBOL = idx;
                if (txt === 'CURRENT' || txt === 'PRICE' || txt === 'RATE') colMap.PRICE = idx;
                if (txt === 'CHANGE' || txt === 'NET CHANGE') colMap.CHANGE = idx;
                if (txt.includes('VOL') || txt === 'VOLUME') colMap.VOLUME = idx;
            });

            if (colMap.SYMBOL === -1 || colMap.PRICE === -1) {
                colMap.SYMBOL = 0; colMap.PRICE = 5; colMap.CHANGE = 6; colMap.VOLUME = 7;
            }

            rows.forEach((row, rIdx) => {
                if (rIdx === 0) return; 
                const cols = row.querySelectorAll("td");
                const maxIndex = Math.max(colMap.SYMBOL, colMap.PRICE, colMap.CHANGE, colMap.VOLUME);
                if (cols.length <= maxIndex) return; 

                let symbol = "";
                const symCell = cols[colMap.SYMBOL];
                const anchor = symCell.querySelector('a');
                if (anchor) symbol = anchor.textContent?.trim().toUpperCase() || "";
                else symbol = (symCell.textContent?.trim().toUpperCase() || "").split(/[\s-]/)[0];

                if (!symbol || TICKER_BLACKLIST.includes(symbol) || symbol.length > 8 || !isNaN(Number(symbol))) return;

                const price = parseFloat(cols[colMap.PRICE]?.textContent?.trim().replace(/,/g, '') || '0');
                const change = parseFloat(cols[colMap.CHANGE]?.textContent?.trim().replace(/,/g, '') || '0');
                const volume = parseFloat(cols[colMap.VOLUME]?.textContent?.trim().replace(/,/g, '') || '0');

                if (price > 0 && volume > 0) stocks.push({ symbol, price, change, volume });
            });
        });

        return stocks.sort((a, b) => b.volume - a.volume).slice(0, 20);
    } catch (e) { return []; }
};

const parseMarketWatchTable = (html: string, results: Record<string, any>, targetTickers: Set<string>) => {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const tables = doc.querySelectorAll("table");
        if (tables.length === 0) return;

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
                if (!symbolText) {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = symCell.innerHTML.replace(/<br\s*\/?>/gi, ' ');
                    symbolText = (tempDiv.textContent || "").toUpperCase().replace(/\s+/g, ' ').trim();
                }
                
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
                let sector = currentGroupHeader;
                if (colMap.SECTOR !== -1 && cols[colMap.SECTOR]) {
                    const secText = cols[colMap.SECTOR].textContent?.trim();
                    if (secText) sector = SECTOR_CODE_MAP[secText] || secText;
                }

                if (price > 0) { 
                    results[matchedTicker] = { price, sector, ldcp: colMap.LDCP !== -1 ? getVal(colMap.LDCP) : 0, high: colMap.HIGH !== -1 ? getVal(colMap.HIGH) : price, low: colMap.LOW !== -1 ? getVal(colMap.LOW) : price, volume: colMap.VOLUME !== -1 ? getVal(colMap.VOLUME) : 0 }; 
                }
            });
        });
    } catch (e) { }
};

// --- NEW FUNCTION TO GET ALL SYMBOLS AND THEIR SECTORS SIMULTANEOUSLY ---
export const fetchAllPSXSymbols = async (): Promise<{ symbols: string[], sectors: Record<string, string> }> => {
    const symbols = new Set<string>();
    const sectorsMap: Record<string, string> = {};

    // 1. ATTEMPT TO SCRAPE THE DEFINITIVE LISTINGS PAGE (Contains ALL stocks, even illiquid ones)
    try {
        const listingsUrl = `https://dps.psx.com.pk/listings`;
        const listingsHtml = await fetchUrlWithFallback(listingsUrl);

        if (listingsHtml && listingsHtml.length > 500) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(listingsHtml, "text/html");
            
            // PSX Listings layout: Column 0 = Symbol, Column 2 = Sector
            const tables = doc.querySelectorAll("table");

            tables.forEach(table => {
                const rows = table.querySelectorAll("tr");
                let symCol = 0; 
                let secCol = 2; 

                // Dynamic header detection just in case PSX changes the column order
                if (rows.length > 0) {
                    const headers = rows[0].querySelectorAll("th, td");
                    headers.forEach((h, idx) => {
                        const txt = h.textContent?.trim().toUpperCase() || "";
                        if (txt === 'SYMBOL') symCol = idx;
                        if (txt === 'SECTOR') secCol = idx;
                    });
                }

                rows.forEach((row, rIdx) => {
                    if (rIdx === 0) return; // Skip headers
                    const cols = row.querySelectorAll("td");
                    if (cols.length <= Math.max(symCol, secCol)) return;

                    let symbol = cols[symCol].textContent?.trim().toUpperCase() || "";
                    let sector = cols[secCol].textContent?.trim() || "";
                    
                    if (symbol) {
                        symbol = symbol.split(/[\s-]/)[0]; // Clean up things like "OGDC (Right)"
                        if (symbol.length >= 2 && symbol.length <= 8 && !TICKER_BLACKLIST.includes(symbol) && isNaN(Number(symbol))) {
                            symbols.add(symbol);
                            if (sector) {
                                // Save the official sector
                                sectorsMap[symbol] = SECTOR_CODE_MAP[sector.toUpperCase()] || sector;
                            }
                        }
                    }
                });
            });
        }
    } catch (e) {
        console.error("Failed to parse listings page", e);
    }

    // 2. FALLBACK: SCRAPE MARKET WATCH (Just in case the listings page is down)
    if (symbols.size === 0) {
        try {
            const targetUrl = `https://dps.psx.com.pk/market-watch`;
            const html = await fetchUrlWithFallback(targetUrl);

            if (html && html.length > 500) {
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, "text/html");
                const tables = doc.querySelectorAll("table");

                tables.forEach(table => {
                    const rows = table.querySelectorAll("tr");
                    let currentGroupHeader = "Unknown Sector";

                    rows.forEach((row, rIdx) => {
                        if (rIdx === 0) return; 

                        const cells = row.querySelectorAll("td, th");
                        if (cells.length === 1 || (cells.length > 0 && cells.length < 4)) {
                            let text = cells[0]?.textContent?.trim() || "";
                            text = text.replace(/[\n\r\t]/g, '').trim();
                            if (text && text.length > 2 && !TICKER_BLACKLIST.includes(text.toUpperCase())) {
                                currentGroupHeader = text;
                            }
                            return;
                        }

                        if (cells.length < 2) return;

                        const symCell = cells[0];
                        let symbol = symCell.querySelector('a')?.textContent?.trim().toUpperCase() || symCell.textContent?.trim().toUpperCase();

                        if (symbol) {
                            symbol = symbol.split(/[\s-]/)[0];
                            if (symbol.length >= 2 && symbol.length <= 8 && !TICKER_BLACKLIST.includes(symbol) && isNaN(Number(symbol))) {
                                symbols.add(symbol);
                                sectorsMap[symbol] = SECTOR_CODE_MAP[currentGroupHeader] || currentGroupHeader;
                            }
                        }
                    });
                });
            }
        } catch (e) {
            console.error("Failed to parse market watch", e);
        }
    }

    return { 
        symbols: Array.from(symbols).sort(), 
        sectors: sectorsMap 
    };
};
