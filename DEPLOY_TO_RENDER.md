# 🚀 Deploy KhetiX Backend to Render

## 📋 Prerequisites
- GitHub account
- Render account (free tier available)
- MongoDB Atlas database (already configured)
- Firebase service account JSON file

---

## 🔧 Step 1: Prepare Your Code

### 1.1 Update MongoDB URI
Your MongoDB URI needs a database name. Update in Render environment variables:
```
mongodb+srv://Ashoke_2005:Ashoke_2005@cluster0.nyodp0k.mongodb.net/khetix?retryWrites=true&w=majority
```
Note: Added `/khetix` as database name

### 1.2 Verify package.json
✅ Already configured correctly with:
- `"start": "node server.js"` - Render will use this
- `"engines"` specified for Node version

### 1.3 Files Created
✅ `render.yaml` - Render configuration
✅ `.env.production` - Production environment template
✅ Updated `.gitignore` - Excludes sensitive files

---

## 📤 Step 2: Push to GitHub

### 2.1 Initialize Git (if not already done)
```bash
cd "d:\new\app devlopment\backend"
git init
git add .
git commit -m "Initial commit - Ready for Render deployment"
```

### 2.2 Create GitHub Repository
1. Go to https://github.com/new
2. Repository name: `khetix-backend`
3. Keep it **Private** (recommended for backend)
4. Don't initialize with README (you already have code)
5. Click "Create repository"

### 2.3 Push Code to GitHub
```bash
git remote add origin https://github.com/YOUR_USERNAME/khetix-backend.git
git branch -M main
git push -u origin main
```

---

## 🌐 Step 3: Deploy on Render

### 3.1 Create New Web Service
1. Go to https://render.com/
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub account (if not connected)
4. Select your repository: `khetix-backend`
5. Click **"Connect"**

### 3.2 Configure Service
Fill in these details:

**Basic Settings:**
- **Name:** `khetix-backend` (or your preferred name)
- **Region:** Singapore (closest to India) or Frankfurt
- **Branch:** `main`
- **Root Directory:** Leave blank
- **Runtime:** `Node`
- **Build Command:** `npm install`
- **Start Command:** `npm start`

**Instance Type:**
- Select **"Free"** (for testing) or **"Starter"** ($7/month for production)

### 3.3 Add Environment Variables
Click **"Advanced"** → **"Add Environment Variable"**

Add these one by one:

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `PORT` | `10000` |
| `MONGO_URI` | `mongodb+srv://Ashoke_2005:Ashoke_2005@cluster0.nyodp0k.mongodb.net/khetix?retryWrites=true&w=majority` |
| `JWT_SECRET` | `a7f9b2e1d4c6f8a3b5e7c9d1f3a5b7c9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9` |
| `JWT_EXPIRES_IN` | `15m` |
| `JWT_REFRESH_SECRET` | `f3a5b7c9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3` |
| `JWT_REFRESH_EXPIRES_IN` | `30d` |
| `LOG_LEVEL` | `info` |
| `API_BASE_URL` | `https://khetix-backend.onrender.com` (update after deployment) |
| `FRONTEND_URL` | Leave empty or add if you have web frontend |
| `MOBILE_APP_URL` | Leave empty (mobile apps work without this) |

⚠️ **IMPORTANT:** After deployment, update `API_BASE_URL` with your actual Render URL

### 3.4 Deploy
1. Click **"Create Web Service"**
2. Render will start building and deploying
3. Wait 3-5 minutes for first deployment
4. You'll see build logs in real-time

---

## 🔐 Step 4: Upload Firebase Service Account (Important!)

Since `firebase-service-account.json` is in `.gitignore`, you need to add it manually:

### Option A: Environment Variable (Recommended)
1. Open your `firebase-service-account.json` file
2. Copy the entire JSON content
3. In Render Dashboard → Your Service → Environment
4. Add new variable:
   - **Key:** `FIREBASE_SERVICE_ACCOUNT`
   - **Value:** Paste the entire JSON (as a single line or multiline)

5. Update your code to read from environment variable:
```javascript
// In your Firebase initialization file
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : require('./config/firebase-service-account.json');
```

### Option B: Render Secret Files
1. In Render Dashboard → Your Service → Environment
2. Scroll to **"Secret Files"**
3. Click **"Add Secret File"**
4. **Filename:** `config/firebase-service-account.json`
5. **Contents:** Paste your Firebase JSON
6. Click **"Save"**

---

## ✅ Step 5: Verify Deployment

### 5.1 Check Deployment Status
- In Render Dashboard, you'll see:
  - ✅ **Live** (green) - Deployment successful
  - 🔴 **Failed** - Check logs for errors

### 5.2 Get Your API URL
Your backend will be available at:
```
https://khetix-backend.onrender.com
```
(Replace `khetix-backend` with your actual service name)

### 5.3 Test Endpoints
Open these URLs in browser or Postman:

**Health Check:**
```
https://khetix-backend.onrender.com/api/health
```
Expected response:
```json
{
  "success": true,
  "status": "healthy",
  "uptime": "123s",
  "pid": 1,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**API Info:**
```
https://khetix-backend.onrender.com/api
```

**Root:**
```
https://khetix-backend.onrender.com/
```

---

## 📱 Step 6: Update Mobile App

Update your mobile app's API base URL to:
```
https://khetix-backend.onrender.com
```

In your React Native / Flutter app:
```javascript
// config.js or constants.js
export const API_BASE_URL = 'https://khetix-backend.onrender.com';
```

---

## 🔄 Step 7: Auto-Deploy on Git Push

Render automatically redeploys when you push to GitHub:

```bash
# Make changes to your code
git add .
git commit -m "Update feature"
git push origin main
```

Render will automatically:
1. Detect the push
2. Build your app
3. Deploy the new version
4. Zero-downtime deployment

---

## ⚙️ Step 8: Configure MongoDB Atlas for Production

### 8.1 Whitelist Render IP
1. Go to MongoDB Atlas → Security → Network Access
2. Click **"Add IP Address"**
3. Click **"Allow Access from Anywhere"** (0.0.0.0/0)
   - Or add Render's specific IPs (check Render docs)
4. Click **"Confirm"**

### 8.2 Verify Database Name
Make sure your MongoDB URI includes the database name:
```
mongodb+srv://...@cluster0.nyodp0k.mongodb.net/khetix
                                                    ^^^^^^
                                                    Database name
```

---

## 🐛 Troubleshooting

### Issue: Build Failed
**Solution:** Check Render logs for errors
- Missing dependencies? Run `npm install` locally first
- Node version mismatch? Check `engines` in package.json

### Issue: MongoDB Connection Failed
**Solutions:**
1. Verify MONGO_URI in environment variables
2. Check MongoDB Atlas Network Access (whitelist 0.0.0.0/0)
3. Ensure database name is in URI: `/khetix`
4. Verify username/password are correct

### Issue: Firebase Push Notifications Not Working
**Solutions:**
1. Verify Firebase service account JSON is uploaded
2. Check environment variable `FIREBASE_SERVICE_ACCOUNT`
3. Verify Firebase project settings

### Issue: App Sleeps on Free Tier
**Render Free Tier Limitation:**
- Apps sleep after 15 minutes of inactivity
- First request after sleep takes 30-60 seconds
- **Solution:** Upgrade to Starter plan ($7/month) for always-on

### Issue: CORS Errors
**Solution:** Update CORS configuration in server.js
```javascript
const allowedOrigins = [
  'https://your-frontend.com',
  'https://khetix-backend.onrender.com',
];
```

---

## 📊 Monitoring & Logs

### View Logs
1. Render Dashboard → Your Service → Logs
2. Real-time logs of all requests and errors
3. Filter by severity: Info, Warn, Error

### Metrics
1. Render Dashboard → Your Service → Metrics
2. View:
   - CPU usage
   - Memory usage
   - Request count
   - Response times

---

## 💰 Pricing

### Free Tier
- ✅ 750 hours/month (enough for 1 service)
- ✅ Automatic HTTPS
- ⚠️ Sleeps after 15 min inactivity
- ⚠️ 512 MB RAM
- ⚠️ Shared CPU

### Starter Plan ($7/month)
- ✅ Always on (no sleep)
- ✅ 512 MB RAM
- ✅ Shared CPU
- ✅ Better for production

### Standard Plan ($25/month)
- ✅ 2 GB RAM
- ✅ Dedicated CPU
- ✅ Best for production with traffic

---

## 🔒 Security Checklist

- ✅ Environment variables set (not in code)
- ✅ `.env` files in `.gitignore`
- ✅ Firebase credentials not committed
- ✅ MongoDB Atlas Network Access configured
- ✅ HTTPS enabled (automatic on Render)
- ✅ Rate limiting enabled in code
- ✅ Helmet security headers enabled
- ✅ CORS properly configured

---

## 🎉 You're Done!

Your backend is now live at:
```
https://khetix-backend.onrender.com
```

### Next Steps:
1. ✅ Test all API endpoints
2. ✅ Update mobile app with production URL
3. ✅ Monitor logs for errors
4. ✅ Set up custom domain (optional)
5. ✅ Consider upgrading to Starter plan for production

---

## 📞 Support

**Render Documentation:** https://render.com/docs
**MongoDB Atlas:** https://www.mongodb.com/docs/atlas/
**Firebase Admin SDK:** https://firebase.google.com/docs/admin/setup

---

## 🔄 Quick Deploy Commands

```bash
# Update code and deploy
git add .
git commit -m "Your commit message"
git push origin main

# Render will auto-deploy in 2-3 minutes
```

---

**Happy Deploying! 🚀**
