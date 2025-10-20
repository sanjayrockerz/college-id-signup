-- Migration: Remove authentication-related fields
-- This migration removes the isVerified field from the User model
-- 
-- ⚠️ WARNING: This will permanently delete the isVerified column and its data
-- ⚠️ Run this migration only after backing up your database
--
-- To apply this migration:
-- 1. Backup your database first
-- 2. Set DATABASE_URL in your .env file
-- 3. Run: npx prisma migrate dev --name remove_auth_fields
--
-- OR apply manually with psql:
-- psql $DATABASE_URL -f prisma/migrations/remove_auth_fields.sql

-- Remove the isVerified column from users table
-- This column was used for email verification which is no longer needed
ALTER TABLE "users" DROP COLUMN IF EXISTS "isVerified";

-- Note: No other auth-related columns found in schema
-- The User model now only contains profile and feature-related fields
