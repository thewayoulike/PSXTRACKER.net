import React, { useState, useMemo } from 'react';
import { Search } from 'lucide-react';

interface TickerSearchProps {
  value: string;
  options: string[];
  onChange: (val: string) => void;
  placeholder?: string;
}

export const TickerSearch: React.FC<TickerSearchProps> = ({ value, options, onChange, placeholder }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState(value);

  const filtered = useMemo(() => {
    if (!query) return options.slice(0, 10);
    return options.filter(opt => opt.includes(query.toUpperCase())).slice(0, 10);
  }, [query, options]);

  return (
    <div className="relative w-full">
      <div className="relative flex items-center">
        <input
          type="text"
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value.toUpperCase());
            onChange(e.target.value.toUpperCase());
          }}
          className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20 outline-none"
          placeholder={placeholder || "Search Symbol..."}
        />
        <Search size={16} className="absolute right-4 text-slate-400 pointer-events-none" />
      </div>

      {isOpen && query.length > 0 && (
        <div className="absolute z-[100] top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl max-h-60 overflow-y-auto">
          {filtered.map(symbol => (
            <div
              key={symbol}
              onClick={() => {
                setQuery(symbol);
                onChange(symbol);
                setIsOpen(false);
              }}
              className="px-4 py-3 hover:bg-emerald-50 dark:hover:bg-slate-700 cursor-pointer font-bold text-slate-700 dark:text-slate-200 border-b border-slate-50 dark:border-slate-700 last:border-0"
            >
              {symbol}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
