-- View360 Voice Calling System Database Migration
-- Adds 'cancelled' to the allowed statuses on the calls table and index for history queries

ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_status_check;

ALTER TABLE calls ADD CONSTRAINT calls_status_check 
  CHECK (status IN ('ringing', 'accepted', 'rejected', 'cancelled', 'missed', 'ended'));

CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at DESC);
