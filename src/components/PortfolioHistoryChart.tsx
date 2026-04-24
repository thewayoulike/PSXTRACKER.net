import React, { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Transaction } from '../types';
import { TrendingUp, Loader2 } from 'lucide-react';

interface Props {
  transactions: Transaction[];
}

export const PortfolioHistoryChart: React.FC<Props> = ({ transactions }) => {
  const [kseData, setKseData] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);

  // Fetch KSE100 Data for the last 30 days
  useEffect(() => {
    const fetchKse = async () => {
      try {
        // Uses the fixed Nginx proxy route
        const res = await fetch('/api/quotes/KSE100/30d');
        if (!res.ok) throw new Error('Failed to fetch KSE100');
        const data = await res.json();
        
        const map: Record<string, number> = {};
        data.forEach((d: { time: number, price: number }) => {
          const dateStr = new Date(d.time).toISOString().split('T')[0];
          map[dateStr] = d.price;
        });
        setKseData(map);
      } catch (error) {
        console.error("Error fetching KSE100 history:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchKse();
  }, []);

  const chartData = useMemo(() => {
    if (transactions.length === 0 && Object.keys(kseData).length === 0) return [];

    // 1. Generate the last 30 days
    const days: string[] = [];
    const today = new Date();
    for (let i = 30; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().split('T')[0]);
    }

    // 2. Calculate raw portfolio value per day
    // (Simplified historical calculation based on deposits/withdrawals/profits)
    let runningValue = 0;
    const rawData = days.map(date => {
      const dayTxs = transactions.filter(t => t.date === date);
      dayTxs.forEach(t => {
        if (t.type === 'DEPOSIT') runningValue += t.price;
        if (t.type === 'WITHDRAWAL') runningValue -= Math.abs(t.price);
        if (t.type === 'HISTORY') runningValue += t.price; // PnL changes
      });
      
      // If we don't have KSE100 for a weekend, carry over the previous day
      const ksePrice = kseData[date] || 0; 
      
      return {
        fullDate: date,
        displayDate: date.substring(5).replace('-', '/'), // MM/DD
        rawPortfolio: runningValue > 0 ? runningValue : 0,
        rawKse: ksePrice
      };
    });

    // 3. PERCENTAGE NORMALIZATION LOGIC
    // Find the first valid value to anchor as 0%
    let firstValidPortfolio = rawData.find(d => d.rawPortfolio > 0)?.rawPortfolio || 1;
    let firstValidKse = rawData.find(d => d.rawKse > 0)?.rawKse || 1;

    // Fill in trailing zeros for KSE100 (weekends) with last known value
    let lastKnownKse = firstValidKse;

    return rawData.map(d => {
      const currentKse = d.rawKse > 0 ? d.rawKse : lastKnownKse;
      if (d.rawKse > 0) lastKnownKse = d.rawKse;

      // Calculate % change: ((Current - First) / First) * 100
      const portfolioPct = d.rawPortfolio > 0 ? ((d.rawPortfolio - firstValidPortfolio) / firstValidPortfolio) * 100 : 0;
      const ksePct = currentKse > 0 ? ((currentKse - firstValidKse) / firstValidKse) * 100 : 0;

      return {
        ...d,
        currentKse,
        portfolioPct: Number(portfolioPct.toFixed(2)),
        ksePct: Number(ksePct.toFixed(2))
      };
    });

  }, [transactions, kseData]);

  // Custom Tooltip to show % and raw values
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const pData = payload[0].payload;
      return (
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-xl border border-slate-100 dark:border-slate-700">
          <p className="text-slate-500 dark:text-slate-400 font-bold mb-2 text-sm">{pData.fullDate}</p>
          
          <div className="flex flex-col gap-1">
            <p className="text-emerald-500 font-bold text-sm">
              Portfolio: {pData.portfolioPct > 0 ? '+' : ''}{pData.portfolioPct}% 
              <span className="text-slate-400 font-normal text-xs ml-1">(Rs. {pData.rawPortfolio.toLocaleString(undefined, {maximumFractionDigits: 0})})</span>
            </p>
            <p className="text-indigo-500 font-bold text-sm">
              KSE-100: {pData.ksePct > 0 ? '+' : ''}{pData.ksePct}%
              <span className="text-slate-400 font-normal text-xs ml-1">({pData.currentKse.toLocaleString(undefined, {maximumFractionDigits: 0})})</span>
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
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Relative Performance (30 Days)</h3>
      </div>
      
      <div className="h-64 sm:h-80 w-full relative">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="displayDate" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} dy={10} minTickGap={20} />
            
            {/* Formats the Y-Axis as a Percentage */}
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(tick) => `${tick}%`} />
            
            <Tooltip content={<CustomTooltip />} />
            
            {/* Zero Line to clearly show Positive vs Negative */}
            <ReferenceLine y={0} stroke="#cbd5e1" strokeDasharray="3 3" />
            
            <Line type="monotone" dataKey="portfolioPct" stroke="#10b981" strokeWidth={3} dot={false} activeDot={{ r: 6, fill: '#10b981', stroke: '#fff', strokeWidth: 2 }} name="Portfolio" />
            <Line type="monotone" dataKey="ksePct" stroke="#6366f1" strokeWidth={3} dot={false} activeDot={{ r: 6, fill: '#6366f1', stroke: '#fff', strokeWidth: 2 }} name="KSE-100" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      
      <div className="flex justify-center items-center gap-6 mt-4">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
          <span className="text-xs font-bold text-slate-600 dark:text-slate-400">Portfolio</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-indigo-500"></div>
          <span className="text-xs font-bold text-slate-600 dark:text-slate-400">KSE-100</span>
        </div>
      </div>
    </div>
  );
};

export default PortfolioHistoryChart;
