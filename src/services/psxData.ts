export type TimeRange = '1D' | '1M' | '6M' | 'YTD' | '1Y' | '3Y' | '5Y';

export const fetchStockHistory = async (symbol: string, range: TimeRange = '1D') => {
    try {
        const res = await fetch(`/api/quotes/${symbol.toUpperCase()}/${range}`);
        if (res.ok) return await res.json();
    } catch (e) { console.error(e); }
    return [];
};

// ... (Rest of your batch fetching logic using /api/proxy remains the same)
