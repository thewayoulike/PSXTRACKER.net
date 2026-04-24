import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

interface TickerSearchProps {
  value: string;
  options: string[];
  onChange: (val: string) => void;
  placeholder?: string;
}

export const TickerSearch: React.FC<TickerSearchProps> = ({ value, options, onChange, placeholder }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Keep local search text synced if the parent clears the form
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Close the dropdown if the user clicks anywhere else on the screen
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Show top 100 stocks when empty, or filter based on typing
  const filtered = useMemo(() => {
    if (!query) return options.slice(0, 100); 
    return options.filter(opt => opt.includes(query.toUpperCase())).slice(0, 100);
  }, [query, options]);

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <div 
        className="relative flex items-center cursor-pointer"
        onClick={() => setIsOpen(true)}
      >
        <input
          type="text"
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value.toUpperCase());
            onChange(e.target.value.toUpperCase());
            setIsOpen(true);
          }}
          className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pl-4 pr-10 py-3 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20 outline-none cursor-text"
          placeholder={placeholder || "Search Symbol..."}
        />
        {/* Added a Dropdown Arrow to make it obvious it's a dropdown */}
        <ChevronDown 
            size={18} 
            className={`absolute right-4 text-slate-400 pointer-events-none transition-transform duration-200 ${isOpen ? 'rotate-180 text-emerald-500' : ''}`} 
        />
      </div>

      {/* REMOVED the query.length > 0 restriction! It will always open now. */}
      {isOpen && (
        <div className="absolute z-[100] top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl max-h-60 overflow-y-auto custom-scrollbar">
          {filtered.length > 0 ? (
              filtered.map(symbol => (
                <div
                  key={symbol}
                  onClick={() => {
                    setQuery(symbol);
                    onChange(symbol);
                    setIsOpen(false);
                  }}
                  className="px-4 py-3 hover:bg-emerald-50 dark:hover:bg-slate-700 cursor-pointer font-bold text-slate-700 dark:text-slate-200 border-b border-slate-50 dark:border-slate-700/50 last:border-0 transition-colors"
                >
                  {symbol}
                </div>
              ))
          ) : (
             <div className="px-4 py-3 text-sm text-slate-400 italic">No matches found.</div>
          )}
        </div>
      )}
    </div>
  );
};
