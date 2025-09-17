#!/bin/bash

# College ID Signup Backend Setup Script

echo "🚀 Setting up College ID Signup Backend..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2)
REQUIRED_VERSION="18.0.0"
if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$NODE_VERSION" | sort -V | head -n1)" != "$REQUIRED_VERSION" ]; then
    echo "❌ Node.js version $NODE_VERSION is too old. Please upgrade to 18+ first."
    exit 1
fi

echo "✅ Node.js version: $(node -v)"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✅ npm version: $(npm -v)"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo "✅ Dependencies installed successfully"

# Copy environment file if it doesn't exist
if [ ! -f .env ]; then
    echo "📄 Creating .env file from template..."
    cp .env.example .env
    echo "✅ .env file created. Please update it with your configuration."
else
    echo "ℹ️  .env file already exists"
fi

# Create uploads directory
if [ ! -d "uploads" ]; then
    echo "📁 Creating uploads directory..."
    mkdir -p uploads
    echo "✅ Uploads directory created"
else
    echo "ℹ️  Uploads directory already exists"
fi

# Generate Prisma client
echo "🗄️  Generating Prisma client..."
npm run prisma:generate

if [ $? -ne 0 ]; then
    echo "❌ Failed to generate Prisma client"
    exit 1
fi

echo "✅ Prisma client generated successfully"

# Check if PostgreSQL is running (optional)
if command -v pg_isready &> /dev/null; then
    if pg_isready -q; then
        echo "✅ PostgreSQL is running"
        
        # Run database migrations
        echo "🗄️  Running database migrations..."
        npm run prisma:migrate
        
        if [ $? -eq 0 ]; then
            echo "✅ Database migrations completed"
            
            # Seed database (optional)
            read -p "Do you want to seed the database with sample data? (y/N): " seed_db
            if [[ $seed_db =~ ^[Yy]$ ]]; then
                echo "🌱 Seeding database..."
                npm run prisma:seed
                if [ $? -eq 0 ]; then
                    echo "✅ Database seeded successfully"
                else
                    echo "⚠️  Database seeding failed (optional)"
                fi
            fi
        else
            echo "⚠️  Database migrations failed. You may need to set up the database manually."
        fi
    else
        echo "⚠️  PostgreSQL is not running. Please start it and run migrations manually."
    fi
else
    echo "ℹ️  PostgreSQL tools not found. Please ensure PostgreSQL is installed and running."
fi

echo ""
echo "🎉 Setup completed!"
echo ""
echo "📋 Next steps:"
echo "   1. Update your .env file with the correct database and JWT configuration"
echo "   2. Make sure PostgreSQL is running and accessible"
echo "   3. Run 'npm run prisma:migrate' to set up the database schema"
echo "   4. Start the development server with 'npm run start:express:dev'"
echo ""
echo "🔗 Available commands:"
echo "   • npm run start:express - Start the Express server"
echo "   • npm run start:express:dev - Start with nodemon (auto-restart)"
echo "   • npm run prisma:studio - Open database browser"
echo "   • npm run prisma:migrate - Run database migrations"
echo ""
echo "📊 Health checks:"
echo "   • http://localhost:3001/health - General health"
echo "   • http://localhost:3001/health/database - Database connectivity"
echo ""
echo "Happy coding! 🚀"
