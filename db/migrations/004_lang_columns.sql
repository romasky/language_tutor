-- Migration 004: native_lang and target_lang on users
-- These columns were applied manually on production but never committed.
-- Additive only — safe to re-run (IF NOT EXISTS guards).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS native_lang TEXT DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS target_lang TEXT DEFAULT 'en';
