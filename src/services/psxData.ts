// Proxy-based fetching to avoid CORS and blocking
export const fetchBatchPSXPrices = async (tickers: string[]): Promise<Record<string, any>> => {
    try {
        const results: Record<string, any> = {};
        
        // We use the /api/proxy route we set up in server.js
        const response = await fetch(`/api/proxy?url=${encodeURIComponent('https://dps.psx.com.pk/market-watch')}`);
        const html = await response.text();
        
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        tickers.forEach(ticker => {
            const row = Array.from(doc.querySelectorAll('tr')).find(r => r.textContent?.includes(ticker));
            if (row) {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 6) {
                    const price = parseFloat(cells[4].textContent?.replace(/,/g, '') || '0');
                    const ldcp = parseFloat(cells[5].textContent?.replace(/,/g, '') || '0');
                    results[ticker] = { price, ldcp, sector: 'Market' };
                }
            }
        });
        
        return results;
    } catch (error) {
        console.error("PSX Fetch Error:", error);
        return {};
    }
};

export const fetchAllPSXSymbols = async () => {
    try {
        const res = await fetch('/api/proxy?url=' + encodeURIComponent('https://dps.psx.com.pk/market-watch'));
        const html = await res.text();
        // Simplified for this example
        return { symbols: [], sectors: {} };
    } catch (e) { return { symbols: [], sectors: {} }; }
};
