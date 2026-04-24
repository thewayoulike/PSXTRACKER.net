export const fetchBatchPSXPrices = async (tickers: string[]) => {
    try {
        // The "?t=" adds a unique timestamp to the URL. 
        // This TRICKS the browser into thinking it's a brand new page, killing the cache!
        const response = await fetch(`/api/live-prices?t=${new Date().getTime()}`);
        
        if (!response.ok) throw new Error('Network response was not ok');
        
        const data = await response.json();
        return data; 
    } catch (error) {
        console.error("❌ Error fetching from API:", error);
        return {};
    }
};
