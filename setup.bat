@echo off
REM College ID Signup Backend Setup Script for Windows

echo 🚀 Setting up College ID Signup Backend...

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js is not installed. Please install Node.js 18+ first.
    pause
    exit /b 1
)

echo ✅ Node.js version: 
node --version

REM Check if npm is installed
npm --version >nul 2>&1
if errorlevel 1 (
    echo ❌ npm is not installed. Please install npm first.
    pause
    exit /b 1
)

echo ✅ npm version: 
npm --version

REM Install dependencies
echo 📦 Installing dependencies...
npm install

if errorlevel 1 (
    echo ❌ Failed to install dependencies
    pause
    exit /b 1
)

echo ✅ Dependencies installed successfully

REM Copy environment file if it doesn't exist
if not exist .env (
    echo 📄 Creating .env file from template...
    copy .env.example .env
    echo ✅ .env file created. Please update it with your configuration.
) else (
    echo ℹ️  .env file already exists
)

REM Create uploads directory
if not exist "uploads" (
    echo 📁 Creating uploads directory...
    mkdir uploads
    echo ✅ Uploads directory created
) else (
    echo ℹ️  Uploads directory already exists
)

REM Generate Prisma client
echo 🗄️  Generating Prisma client...
npm run prisma:generate

if errorlevel 1 (
    echo ❌ Failed to generate Prisma client
    pause
    exit /b 1
)

echo ✅ Prisma client generated successfully

echo.
echo 🎉 Setup completed!
echo.
echo 📋 Next steps:
echo    1. Update your .env file with the correct database and JWT configuration
echo    2. Make sure PostgreSQL is running and accessible
echo    3. Run 'npm run prisma:migrate' to set up the database schema
echo    4. Start the development server with 'npm run start:express:dev'
echo.
echo 🔗 Available commands:
echo    • npm run start:express - Start the Express server
echo    • npm run start:express:dev - Start with nodemon (auto-restart)
echo    • npm run prisma:studio - Open database browser
echo    • npm run prisma:migrate - Run database migrations
echo.
echo 📊 Health checks:
echo    • http://localhost:3001/health - General health
echo    • http://localhost:3001/health/database - Database connectivity
echo.
echo Happy coding! 🚀

pause
