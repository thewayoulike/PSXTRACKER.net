import React, { useState, useEffect, useMemo } from 'react';
import { Transaction } from '../types';
import { fetchStockHistory, fetchIndexHistory } from '../services/psxData';
import { Card } from './ui/Card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { TrendingUp, Loader2 } from 'lucide-react';

interface PortfolioHistoryChartProps {
  transactions: Transaction[];
}

export const PortfolioHistoryChart: React.FC<PortfolioHistoryChartProps> = ({ transactions }) => {
  const [chartData, setChartData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const buildHistory = async () => {
      setLoading(true);
      try {
        // 1. Identify all unique tickers the user has ever owned
        const tickers = Array.from(new Set(transactions.map(t => t.ticker).filter(t => !['CASH', 'CGT'].includes(t))));
        
        // 2. Fetch 1-Year History for KSE100 and all owned stocks
        const [kse100History, ...stockHistories] = await Promise.all([
          fetchIndexHistory('KSE100'),
          ...tickers.map(ticker => fetchStockHistory(ticker, '1Y'))
        ]);

        // 3. Map history data by Ticker -> Date (YYYY-MM-DD) -> Price
        const priceMap: Record<string, Record<string, number>> = {};
        tickers.forEach((ticker, index) => {
            priceMap[ticker] = {};
            stockHistories[index].forEach(point => {
                const d = new Date(point.time).toISOString().split('T')[0];
                priceMap[ticker][d] = point.price;
            });
        });

        // 4. Generate the last 30 days
        const last30Days = [];
        for (let i = 30; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            last30Days.push(d.toISOString().split('T')[0]);
        }

        // 5. Calculate Portfolio Value & Match KSE100 per day
        const finalData = last30Days.map(dateStr => {
            // Find KSE100 price for this day (fallback to previous day if weekend/holiday)
            let ksePrice = 0;
            const ksePoint = kse100History.find(h => new Date(h.time).toISOString().split('T')[0] === dateStr);
            if (ksePoint) ksePrice = ksePoint.price;

            // Calculate Portfolio Value for this specific day
            let dailyPortfolioValue = 0;
            tickers.forEach(ticker => {
                // Find quantity owned ON OR BEFORE this date
                const txsToDate = transactions.filter(t => t.ticker === ticker && new Date(t.date).getTime() <= new Date(dateStr).getTime());
                const qty = txsToDate.reduce((sum, t) => {
                    if (t.type === 'BUY') return sum + t.quantity;
                    if (t.type === 'SELL') return sum - t.quantity;
                    return sum;
                }, 0);

                if (qty > 0) {
                    // Get price for this day. If missing (holiday), grab the last known price.
                    let price = priceMap[ticker][dateStr];
                    if (!price) {
                        const availableDates = Object.keys(priceMap[ticker]).filter(d => new Date(d) <= new Date(dateStr)).sort();
                        if (availableDates.length > 0) {
                            price = priceMap[ticker][availableDates[availableDates.length - 1]];
                        }
                    }
                    if (price) dailyPortfolioValue += (qty * price);
                }
            });

            return {
                date: dateStr,
                Portfolio: dailyPortfolioValue,
                KSE100: ksePrice
            };
        }).filter(d => d.Portfolio > 0 || d.KSE100 > 0);

        setChartData(finalData);
      } catch (err) {
        console.error("Failed to build history", err);
      } finally {
        setLoading(false);
      }
    };

    if (transactions.length > 0) {
        buildHistory();
    }
  }, [transactions]);

  // Format Y-Axis numbers (e.g., 1000000 -> 1M, 50000 -> 50K)
  const formatYAxis = (tickItem: number) => {
      if (tickItem >= 1000000) return `${(tickItem / 1000000).toFixed(1)}M`;
      if (tickItem >= 1000) return `${(tickItem / 1000).toFixed(0)}k`;
      return tickItem.toString();
  };

  if (transactions.length === 0) return null;

  return (
    <Card className="p-6 mt-6 animate-in fade-in slide-in-from-bottom-5 duration-700">
        <div className="flex justify-between items-center mb-6">
            <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <TrendingUp size={20} className="text-emerald-500" />
                Portfolio vs. KSE-100 (30 Days)
            </h3>
            {loading && <Loader2 size={16} className="animate-spin text-slate-400" />}
        </div>

        <div className="h-72 w-full">
            {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis 
                            dataKey="date" 
                            tickFormatter={(str) => str.split('-').slice(1).join('/')}
                            tick={{fontSize: 10, fill: '#94a3b8'}}
                            axisLine={false}
                            tickLine={false}
                        />
                        {/* Left Y-Axis for Portfolio Value */}
                        <YAxis 
                            yAxisId="left"
                            tickFormatter={formatYAxis} 
                            tick={{fontSize: 10, fill: '#94a3b8'}}
                            axisLine={false}
                            tickLine={false}
                        />
                        {/* Right Y-Axis for KSE-100 Index */}
                        <YAxis 
                            yAxisId="right"
                            orientation="right"
                            tickFormatter={formatYAxis} 
                            tick={{fontSize: 10, fill: '#94a3b8'}}
                            axisLine={false}
                            tickLine={false}
                        />
                        <Tooltip 
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                            formatter={(value: number, name: string) => [`Rs. ${value.toLocaleString()}`, name]}
                        />
                        <Legend wrapperStyle={{ fontSize: '12px' }}/>
                        <Line yAxisId="left" type="monotone" dataKey="Portfolio" stroke="#10b981" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
                        <Line yAxisId="right" type="monotone" dataKey="KSE100" stroke="#6366f1" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
                    </LineChart>
                </ResponsiveContainer>
            ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
                    {loading ? "Reconstructing historical portfolio data..." : "Not enough data to draw chart."}
                </div>
            )}
        </div>
    </Card>
  );
};
