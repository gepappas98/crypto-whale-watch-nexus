-- ══ HELPER: increment_hl_counter ════════════════════════════════════════════
-- Called by the edge function to atomically increment the outgoing request
-- counter for a given minute bucket and return the new count.
-- If the bucket is new, it is created with count = 1.
-- This avoids race conditions from concurrent edge function instances.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION increment_hl_counter(
  p_window TEXT,
  p_max    INTEGER DEFAULT 200
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO hl_rate_counter (window_key, count, updated_at)
  VALUES (p_window, 1, NOW())
  ON CONFLICT (window_key) DO UPDATE
    SET count      = hl_rate_counter.count + 1,
        updated_at = NOW()
  RETURNING count INTO v_count;

  -- Cleanup old windows (keep only last 5 minutes)
  DELETE FROM hl_rate_counter
  WHERE updated_at < NOW() - INTERVAL '5 minutes';

  RETURN v_count;
END;
$$;

-- Grant execute to service role (edge function)
GRANT EXECUTE ON FUNCTION increment_hl_counter(TEXT, INTEGER) TO service_role;
