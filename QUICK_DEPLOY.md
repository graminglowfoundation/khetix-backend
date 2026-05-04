# 🚀 Quick Deploy Reference

## 📤 Push to GitHub
```bash
cd "d:\new\app devlopment\backend"
git init
git add .
git commit -m "Ready for Render deployment"
git remote add origin https://github.com/YOUR_USERNAME/khetix-backend.git
git branch -M main
git push -u origin main
```

## 🌐 Render Setup (One-Time)
1. Go to: https://render.com/
2. New + → Web Service
3. Connect GitHub repo: `khetix-backend`
4. Configure:
   - **Name:** khetix-backend
   - **Region:** Singapore
   - **Build:** `npm install`
   - **Start:** `npm start`
   - **Plan:** Free (or Starter $7/month)

## 🔐 Environment Variables (Add in Render)
```
NODE_ENV=production
PORT=10000
MONGO_URI=mongodb+srv://Ashoke_2005:Ashoke_2005@cluster0.nyodp0k.mongodb.net/khetix?retryWrites=true&w=majority
JWT_SECRET=a7f9b2e1d4c6f8a3b5e7c9d1f3a5b7c9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=f3a5b7c9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3
JWT_REFRESH_EXPIRES_IN=30d
LOG_LEVEL=info
API_BASE_URL=https://your-app-name.onrender.com
```

## 🔥 Firebase Setup (Important!)
**Option 1: Environment Variable (Recommended)**
1. Copy entire content of `firebase-service-account.json`
2. In Render → Environment → Add Variable:
   - Key: `FIREBASE_SERVICE_ACCOUNT`
   - Value: Paste JSON content

**Option 2: Secret File**
1. Render → Environment → Secret Files
2. Add Secret File:
   - Filename: `config/firebase-service-account.json`
   - Contents: Paste JSON

## 🗄️ MongoDB Atlas Setup
1. Go to: https://cloud.mongodb.com/
2. Security → Network Access
3. Add IP Address → Allow Access from Anywhere (0.0.0.0/0)
4. Confirm

## ✅ Test Your Deployment
```
https://your-app-name.onrender.com/api/health
https://your-app-name.onrender.com/api
https://your-app-name.onrender.com/
```

## 🔄 Update & Redeploy
```bash
git add .
git commit -m "Update message"
git push origin main
# Render auto-deploys in 2-3 minutes
```

## 📱 Update Mobile App
```javascript
// In your mobile app config
const API_BASE_URL = 'https://your-app-name.onrender.com';
```

## 🐛 Common Issues

### MongoDB Connection Failed
- Check MONGO_URI has `/khetix` database name
- Verify MongoDB Atlas Network Access (0.0.0.0/0)
- Check username/password

### Firebase Not Working
- Verify FIREBASE_SERVICE_ACCOUNT env var is set
- Check JSON is valid (no extra quotes)

### App Sleeps (Free Tier)
- First request takes 30-60s after 15min inactivity
- Upgrade to Starter ($7/month) for always-on

### CORS Errors
- Add your frontend URL to allowedOrigins in server.js
- Redeploy after changes

## 📊 Monitor
- **Logs:** Render Dashboard → Your Service → Logs
- **Metrics:** Render Dashboard → Your Service → Metrics

## 💰 Pricing
- **Free:** 750 hrs/month, sleeps after 15min
- **Starter:** $7/month, always-on, 512MB RAM
- **Standard:** $25/month, 2GB RAM, dedicated CPU

---

**Full Guide:** See `DEPLOY_TO_RENDER.md`
