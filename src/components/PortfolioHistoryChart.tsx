import React, { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Transaction } from '../types';
import { TrendingUp, Loader2 } from 'lucide-react';

interface Props {
  transactions: Transaction[];
}

export const PortfolioHistoryChart: React.FC<Props> = ({ transactions }) => {
  const [marketData, setMarketData] = useState<Record<string, Record<string, number>>>({});
  const [isLoading, setIsLoading] = useState(true);

  // Get a unique list of all the stocks you have traded
  const uniqueTickers = useMemo(() => {
    const tickers = new Set(transactions.map(t => t.ticker).filter(t => t && t !== 'ANNUAL FEE' && t !== 'PREV-PNL' && t !== 'KSE100'));
    return Array.from(tickers);
  }, [transactions]);

  // Fetch 30-day history for KSE100 AND all your individual stocks
  useEffect(() => {
    const fetchAllData = async () => {
      setIsLoading(true);
      try {
        const dataMap: Record<string, Record<string, number>> = {};

        // 1. Fetch KSE100
        const kseRes = await fetch('/api/quotes/KSE100/30d');
        if (kseRes.ok) {
          const kseJson = await kseRes.json();
          kseJson.forEach((d: any) => {
            const dateStr = new Date(d.time).toISOString().split('T')[0];
            if (!dataMap[dateStr]) dataMap[dateStr] = {};
            dataMap[dateStr]['KSE100'] = d.price;
          });
        }

        // 2. Fetch all individual stocks
        await Promise.all(uniqueTickers.map(async (ticker) => {
          const res = await fetch(`/api/quotes/${ticker}/30d`);
          if (res.ok) {
            const json = await res.json();
            json.forEach((d: any) => {
              const dateStr = new Date(d.time).toISOString().split('T')[0];
              if (!dataMap[dateStr]) dataMap[dateStr] = {};
              dataMap[dateStr][ticker] = d.price;
            });
          }
        }));

        setMarketData(dataMap);
      } catch (error) {
        console.error("Error fetching chart data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAllData();
  }, [uniqueTickers.join(',')]);

  const chartData = useMemo(() => {
    if (Object.keys(marketData).length === 0) return [];

    const days: string[] = [];
    const today = new Date();
    for (let i = 30; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().split('T')[0]);
    }

    const result = [];
    let prevKse = 0;
    let prevStockPrices: Record<string, number> = {};

    for (let i = 0; i < days.length; i++) {
      const date = days[i];
      const dayData = marketData[date] || {};

      // Calculate KSE Daily % Change
      const currentKse = dayData['KSE100'] || prevKse;
      let kseDailyPct = 0;
      if (prevKse > 0 && currentKse > 0) {
        kseDailyPct = ((currentKse - prevKse) / prevKse) * 100;
      }
      if (currentKse > 0) prevKse = currentKse;

      // Calculate Portfolio Average Daily % Change
      let stockPctSum = 0;
      let stockCount = 0;

      uniqueTickers.forEach(ticker => {
        const currentPrice = dayData[ticker] || prevStockPrices[ticker];
        const prevPrice = prevStockPrices[ticker];

        if (prevPrice > 0 && currentPrice > 0) {
          const dailyPct = ((currentPrice - prevPrice) / prevPrice) * 100;
          stockPctSum += dailyPct;
          stockCount++;
        }
        if (currentPrice > 0) {
           prevStockPrices[ticker] = currentPrice;
        }
      });

      const portfolioDailyPct = stockCount > 0 ? (stockPctSum / stockCount) : 0;

      result.push({
        fullDate: date,
        displayDate: date.substring(5).replace('-', '/'),
        ksePct: Number(kseDailyPct.toFixed(2)),
        portfolioPct: Number(portfolioDailyPct.toFixed(2))
      });
    }

    // Remove the first day since it has no "yesterday" to compare to
    return result.slice(1);
  }, [marketData, uniqueTickers]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const pData = payload[0].payload;
      return (
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-xl border border-slate-100 dark:border-slate-700">
          <p className="text-slate-500 dark:text-slate-400 font-bold mb-2 text-sm">{pData.fullDate}</p>
          <div className="flex flex-col gap-1">
            <p className="text-emerald-500 font-bold text-sm">
              Portfolio Avg: {pData.portfolioPct > 0 ? '+' : ''}{pData.portfolioPct}% 
            </p>
            <p className="text-indigo-500 font-bold text-sm">
              KSE-100: {pData.ksePct > 0 ? '+' : ''}{pData.ksePct}%
            </p>
          </div>
        </div>
      );
    }
    return null;
  };

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800 h-80 flex items-center justify-center">
        <Loader2 className="animate-spin text-emerald-500" size={32} />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-6 shadow-sm border border-slate-200 dark:border-slate-800 w-full overflow-hidden">
      <div className="flex items-center gap-2 mb-6">
        <TrendingUp className="text-emerald-500" size={20} />
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Daily Return % (30 Days)</h3>
      </div>
      
      <div className="h-64 sm:h-80 w-full relative">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="displayDate" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} dy={10} minTickGap={20} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(tick) => `${tick}%`} />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={0} stroke="#cbd5e1" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="portfolioPct" stroke="#10b981" strokeWidth={3} dot={false} activeDot={{ r: 6, fill: '#10b981', stroke: '#fff', strokeWidth: 2 }} name="Portfolio" />
            <Line type="monotone" dataKey="ksePct" stroke="#6366f1" strokeWidth={3} dot={false} activeDot={{ r: 6, fill: '#6366f1', stroke: '#fff', strokeWidth: 2 }} name="KSE-100" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default PortfolioHistoryChart;
