import React, { useState, useEffect, useCallback } from 'react';
import { Dashboard } from './components/Dashboard';
import { fetchBatchPSXPrices } from './services/psxData';

function App() {
  const [transactions, setTransactions] = useState([]);
  const [syncStatus, setSyncStatus] = useState("System Active: Server Syncing...");

  const performSync = useCallback(async () => {
    try {
      // Just fetch the data, the backend is doing all the scraping now!
      await fetchBatchPSXPrices([]);
      setSyncStatus(`Live Data Connected 🟢 | Last checked: ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      setSyncStatus("System: Sync Error 🔴");
    }
  }, []);

  useEffect(() => {
    performSync();
    // Refresh the screen every 1 minute
    const interval = setInterval(performSync, 60000); 
    return () => clearInterval(interval);
  }, [performSync]);

  return (
    <div>
      <div style={{background: '#000', color: '#0f0', padding: '5px', fontSize: '12px', textAlign: 'center'}}>
        {syncStatus}
      </div>
      <Dashboard transactions={transactions} setTransactions={setTransactions} onManualSync={performSync} />
    </div>
  );
}
export default App;
