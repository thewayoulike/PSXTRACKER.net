import React, { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { TrendingUp, Loader2 } from 'lucide-react';

export const PortfolioHistoryChart = ({ transactions }: any) => {
  const [chartData, setChartData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Get unique active tickers from transactions (Ignore dummy tickers like CASH)
  const tickers = useMemo(() => Array.from(new Set(
      transactions
        .map((t: any) => t.ticker)
        .filter((t: string) => t && t.length < 10 && t !== 'CASH' && t !== 'CGT')
  )), [transactions]);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        // 1. Fetch KSE100 History from our local Node.js API
        const kseRes = await fetch('https://psx-tracker.com/api/kse100-history');
        const kseData = kseRes.ok ? await kseRes.json() : [];

        // 2. Fetch Stock History from our local Node.js API for all held tickers
        const stockHistory: Record<string, Record<string, number>> = {};
        await Promise.all(tickers.map(async (sym) => {
          const r = await fetch(`https://psx-tracker.com/api/history/${sym}`);
          if (r.ok) {
              const data = await r.json();
              stockHistory[sym as string] = {};
              data.forEach((d: any) => {
                 // Store the pre-calculated percentage change for that specific date
                 stockHistory[sym as string][d.date] = d.change_percent || 0;
              });
          }
        }));

        // Helper: Calculate what tickers were actually held on a specific historical date
        const getHeldTickersOnDate = (date: string) => {
            const balances: Record<string, number> = {};
            transactions.forEach((tx: any) => {
                // Count transactions that happened ON or BEFORE this historical date
                if (tx.date <= date && tx.ticker) {
                    if (tx.type === 'BUY' || tx.type === 'TRANSFER_IN') {
                        balances[tx.ticker] = (balances[tx.ticker] || 0) + tx.quantity;
                    } else if (tx.type === 'SELL' || tx.type === 'TRANSFER_OUT') {
                        balances[tx.ticker] = (balances[tx.ticker] || 0) - tx.quantity;
                    }
                }
            });
            // Return only tickers where the holding quantity is > 0
            return Object.keys(balances).filter(t => balances[t] > 0.001);
        };

        // 3. Build Chart Data using KSE100 dates as the main timeline
        const formattedData = kseData.map((kseDay: any) => {
            const date = kseDay.date;
            
            // Find out what the user held on this exact day
            const heldTickers = getHeldTickersOnDate(date);

            let sumPct = 0;
            let count = 0;

            // Aggregate the % change ONLY for the held tickers
            heldTickers.forEach(ticker => {
                if (stockHistory[ticker] && stockHistory[ticker][date] !== undefined) {
                    sumPct += stockHistory[ticker][date];
                    count++;
                }
            });

            // Calculate the simple average return of the portfolio for that day
            const portAvg = count > 0 ? sumPct / count : 0;

            return {
                date: date.substring(5), // Converts '2026-04-24' to '04-24' for cleaner X-Axis
                kse: Number((kseDay.change_percent || 0).toFixed(2)),
                portfolio: Number(portAvg.toFixed(2))
            };
        });

        setChartData(formattedData);
      } catch (e) {
        console.error("Failed to load chart data", e);
      } finally {
        setLoading(false);
      }
    };

    if (tickers.length > 0) {
        loadData();
    } else {
        setChartData([]);
        setLoading(false);
    }
  }, [tickers.join(','), transactions]);

  if (loading) {
      return (
          <div className="h-64 flex items-center justify-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 mt-6 shadow-sm">
              <Loader2 className="animate-spin text-emerald-500" size={32} />
          </div>
      );
  }

  if (chartData.length === 0) return null;

  return (
    <div className="bg-white dark:bg-slate-900 p-4 md:p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm mt-6">
      <h3 className="text-sm md:text-base font-bold mb-6 flex items-center gap-2 text-slate-800 dark:text-slate-100">
        <TrendingUp size={18} className="text-emerald-500" /> 
        30-Day Daily Return % (Portfolio Avg vs KSE-100)
      </h3>
      
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis 
                dataKey="date" 
                fontSize={10} 
                tickLine={false} 
                axisLine={false} 
                stroke="#64748b" 
            />
            <YAxis 
                tickFormatter={t => `${t}%`} 
                fontSize={10} 
                tickLine={false} 
                axisLine={false} 
                stroke="#64748b" 
            />
            <Tooltip 
                contentStyle={{ 
                    borderRadius: '12px', 
                    border: '1px solid #e2e8f0', 
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                    backgroundColor: 'rgba(255, 255, 255, 0.95)'
                }}
                itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                labelStyle={{ fontSize: '10px', color: '#64748b', marginBottom: '4px' }}
            />
            <ReferenceLine y={0} stroke="#cbd5e1" strokeWidth={2} />
            
            <Line 
                type="monotone" 
                dataKey="portfolio" 
                stroke="#10b981" 
                strokeWidth={3} 
                dot={{ r: 3, strokeWidth: 0 }} 
                activeDot={{ r: 6 }} 
                name="Portfolio Avg %" 
            />
            <Line 
                type="monotone" 
                dataKey="kse" 
                stroke="#6366f1" 
                strokeWidth={2} 
                dot={{ r: 2, strokeWidth: 0 }} 
                activeDot={{ r: 4 }} 
                name="KSE-100 %" 
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
