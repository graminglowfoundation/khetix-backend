#!/bin/bash

# Agriculture App Backend Setup Script for Linux/Mac

echo ""
echo "╔════════════════════════════════════════╗"
echo "║  🌾 Agriculture App Backend Setup      ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Check if Node.js is installed
echo "Checking Node.js installation..."
if ! command -v node &> /dev/null; then
    echo "✗ Node.js is not installed!"
    echo "Please download and install from: https://nodejs.org/"
    exit 1
fi
echo "✓ Node.js $(node --version) installed"
echo ""

# Check if npm is installed
echo "Checking npm installation..."
if ! command -v npm &> /dev/null; then
    echo "✗ npm is not installed!"
    exit 1
fi
echo "✓ npm $(npm --version) installed"
echo ""

# Install dependencies
echo "Installing dependencies..."
npm install
if [ $? -ne 0 ]; then
    echo "✗ Failed to install dependencies"
    exit 1
fi
echo "✓ Dependencies installed"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "Creating .env file from template..."
    cp .env.example .env
    echo "✓ .env file created"
    echo ""
    echo "⚠️  IMPORTANT: Edit .env file and add your MongoDB Atlas credentials:"
    echo "   1. Open .env in a text editor"
    echo "   2. Replace MONGODB_URI with your connection string"
    echo "   3. Generate JWT_SECRET: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    echo "   4. Save the file"
    echo ""
else
    echo "✓ .env file already exists"
    echo ""
fi

echo "╔════════════════════════════════════════╗"
echo "║  ✓ Setup Complete!                    ║"
echo "╚════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your MongoDB credentials"
echo "2. Run: npm run dev (development mode)"
echo "3. Or run: npm start (production mode)"
echo ""
