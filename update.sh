#!/bin/bash
echo "🚀 Starting Update..."
git reset --hard HEAD
git pull origin main
echo "📦 Building Frontend..."
npm run build
echo "🔄 Restarting Backend..."
pm2 restart psx-backend
echo "✅ Done!"
