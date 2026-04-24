import React from 'react';
import { Holding } from '../types';
import { ArrowUpRight, ArrowDownRight, Clock } from 'lucide-react';

interface Props {
  holdings: Holding[];
  showBroker?: boolean;
  failedTickers?: Set<string>;
  ldcpMap: Record<string, number>;
  onTickerClick?: (ticker: string) => void;
}

export const HoldingsTable: React.FC<Props> = ({ holdings, showBroker, failedTickers, ldcpMap, onTickerClick }) => {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
      <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Current Holdings</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/50">
              <th className="px-6 py-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Symbol</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase text-right">Qty</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase text-right">Avg Cost</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase text-right">Current Price</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase text-right">Daily %</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase text-right">Total P&L</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {holdings.map((holding) => {
              const ldcp = ldcpMap[holding.ticker] || holding.currentPrice;
              const dailyChange = ((holding.currentPrice - ldcp) / ldcp) * 100;
              const totalPnL = (holding.currentPrice - holding.avgPrice) * holding.quantity;
              const pnlPercent = (totalPnL / (holding.avgPrice * holding.quantity)) * 100;
              const isFailed = failedTickers?.has(holding.ticker);

              return (
                <tr key={`${holding.ticker}-${holding.broker}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-6 py-4">
                    <button onClick={() => onTickerClick?.(holding.ticker)} className="font-bold text-emerald-600 dark:text-emerald-400 hover:underline">
                      {holding.ticker}
                    </button>
                    {isFailed && <span className="ml-2 text-[10px] bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded-full">Sync Error</span>}
                  </td>
                  <td className="px-6 py-4 text-right font-medium">{holding.quantity.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right text-slate-500 dark:text-slate-400">Rs. {holding.avgPrice.toFixed(2)}</td>
                  <td className="px-6 py-4 text-right font-bold text-slate-800 dark:text-slate-100">
                    Rs. {holding.currentPrice.toFixed(2)}
                  </td>
                  <td className={`px-6 py-4 text-right font-bold ${dailyChange >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                    <div className="flex items-center justify-end gap-1">
                      {dailyChange >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                      {Math.abs(dailyChange).toFixed(2)}%
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className={`font-bold ${totalPnL >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {totalPnL >= 0 ? '+' : ''}Rs. {totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className={`text-xs font-medium ${totalPnL >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {totalPnL >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
