const fs = require('fs');
const path = '/var/www/psxtracker/src/components/App.tsx';

let content = fs.readFileSync(path, 'utf8');

const newBlock = `  // --- NEW: AUTO-UPDATER FOR LIVE PRICES (Strict PKT Schedule) ---
  useEffect(() => {
      const intervalId = setInterval(() => {
          // 1. Get current time strictly in PKT
          const pktTimeString = new Date().toLocaleString("en-US", { timeZone: "Asia/Karachi" });
          const pktDate = new Date(pktTimeString);
          
          const day = pktDate.getDay();
          const hours = pktDate.getHours();
          const minutes = pktDate.getMinutes();
          
          // 2. Monday to Friday only
          const isWeekday = day >= 1 && day <= 5;
          
          // 3. Between 9:15 AM and 4:30 PM (16:30)
          const isAfterOpen = hours > 9 || (hours === 9 && minutes >= 15);
          const isBeforeClose = hours < 16 || (hours === 16 && minutes <= 30);
          
          // 4. Trigger sync
          if (isWeekday && isAfterOpen && isBeforeClose && holdings.length > 0) {
              console.log("Auto-updating live market prices (Market Open PKT)...");
              handleSyncPrices(true);
          }
      }, 180000); // 3 minutes

      return () => clearInterval(intervalId);
  }, [holdings]);`;

// Replace the old block with the new block
content = content.replace(/\/\/ --- NEW: AUTO-UPDATER FOR LIVE PRICES \(Every 3 Minutes\) ---[\s\S]*?\}, \[holdings\]\);[^\n]*/, newBlock);

fs.writeFileSync(path, content, 'utf8');
console.log("App.tsx successfully updated with strict PKT schedule!");
