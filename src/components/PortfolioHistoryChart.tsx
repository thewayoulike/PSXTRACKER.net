import React, { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { TrendingUp, Loader2 } from 'lucide-react';

export const PortfolioHistoryChart = ({ transactions }: any) => {
  const [marketData, setMarketData] = useState<any>({});
  const [loading, setLoading] = useState(true);

  const tickers = useMemo(() => Array.from(new Set(transactions.map((t:any) => t.ticker).filter((t:any) => t && t.length < 10))), [transactions]);

  useEffect(() => {
    const load = async () => {
      const data: any = {};
      const fetchTicks = ['KSE100', ...tickers];
      await Promise.all(fetchTicks.map(async (sym) => {
        const r = await fetch(`/api/quotes/${sym}/30d`);
        const json = await r.json();
        json.forEach((d: any) => {
           const ds = new Date(d.time).toISOString().split('T')[0];
           if(!data[ds]) data[ds] = {};
           data[ds][sym] = d.price;
        });
      }));
      setMarketData(data);
      setLoading(false);
    };
    load();
  }, [tickers.join(',')]);

  const chartData = useMemo(() => {
    const days = Object.keys(marketData).sort();
    if (days.length < 2) return [];
    
    return days.map((day, i) => {
      if (i === 0) return null;
      const prev = marketData[days[i-1]];
      const curr = marketData[day];
      
      // KSE100 Daily %
      const ksePct = prev['KSE100'] ? ((curr['KSE100'] - prev['KSE100']) / prev['KSE100']) * 100 : 0;
      
      // Average of all Portfolio Stocks Daily %
      let sum = 0, count = 0;
      tickers.forEach(t => {
        if (prev[t] && curr[t]) {
          sum += ((curr[t] - prev[t]) / prev[t]) * 100;
          count++;
        }
      });

      return {
        date: day.substring(5),
        kse: Number(ksePct.toFixed(2)),
        portfolio: count > 0 ? Number((sum / count).toFixed(2)) : 0
      };
    }).filter(d => d !== null);
  }, [marketData, tickers]);

  if (loading) return <div className="h-64 flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800">
      <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><TrendingUp size={20}/> Daily Return % vs KSE-100</h3>
      <div className="h-64">
        <ResponsiveContainer>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" fontSize={10} />
            <YAxis tickFormatter={t => `${t}%`} fontSize={10} />
            <Tooltip />
            <ReferenceLine y={0} stroke="#94a3b8" />
            <Line type="monotone" dataKey="portfolio" stroke="#10b981" strokeWidth={3} dot={false} name="Portfolio Avg %" />
            <Line type="monotone" dataKey="kse" stroke="#6366f1" strokeWidth={2} dot={false} name="KSE-100 %" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
