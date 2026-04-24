/* FORCE UPDATE: $(date) */
export const fetchBatchPSXPrices = async (tickers: string[]) => {
    try {
        const t = Date.now();
        const response = await fetch(`/api/live-prices?t=${t}`);
        if (!response.ok) throw new Error('API Down');
        return await response.json();
    } catch (error) {
        console.error("Fetch error:", error);
        return {};
    }
};

// Dummy functions to prevent import errors in App.tsx
export const setScrapingApiKey = () => {};
export const setWebScrapingAIKey = () => {};
export const fetchAllPSXSymbols = async () => [];
