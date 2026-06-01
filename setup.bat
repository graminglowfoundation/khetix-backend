@echo off
REM Agriculture App Backend Setup Script for Windows

echo.
echo ╔════════════════════════════════════════╗
echo ║  🌾 Agriculture App Backend Setup      ║
echo ╚════════════════════════════════════════╝
echo.

REM Check if Node.js is installed
echo Checking Node.js installation...
node --version >nul 2>&1
if errorlevel 1 (
    echo ✗ Node.js is not installed!
    echo Please download and install from: https://nodejs.org/
    pause
    exit /b 1
)
echo ✓ Node.js installed
echo.

REM Check if npm is installed
echo Checking npm installation...
npm --version >nul 2>&1
if errorlevel 1 (
    echo ✗ npm is not installed!
    pause
    exit /b 1
)
echo ✓ npm installed
echo.

REM Install dependencies
echo Installing dependencies...
call npm install
if errorlevel 1 (
    echo ✗ Failed to install dependencies
    pause
    exit /b 1
)
echo ✓ Dependencies installed
echo.

REM Check if .env exists
if not exist .env (
    echo Creating .env file from template...
    copy .env.example .env >nul
    echo ✓ .env file created
    echo.
    echo ⚠️  IMPORTANT: Edit .env file and add your MongoDB Atlas credentials:
    echo    1. Open .env in a text editor
    echo    2. Replace MONGODB_URI with your connection string
    echo    3. Generate JWT_SECRET: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    echo    4. Save the file
    echo.
) else (
    echo ✓ .env file already exists
    echo.
)

echo ╔════════════════════════════════════════╗
echo ║  ✓ Setup Complete!                    ║
echo ╚════════════════════════════════════════╝
echo.
echo Next steps:
echo 1. Edit .env file with your MongoDB credentials
echo 2. Run: npm run dev (development mode)
echo 3. Or run: npm start (production mode)
echo.
pause
