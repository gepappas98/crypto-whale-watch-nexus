-- council_decisions is public analytics data: readable by anyone, but writes
-- must not be forgeable. Drop the open INSERT/UPDATE policies and revoke the
-- underlying grants so all writes go through the council-persist edge function
-- (service role), which validates input and computes performance server-side.

DROP POLICY IF EXISTS "Anyone can record a council decision" ON public.council_decisions;
DROP POLICY IF EXISTS "Anyone can update council performance" ON public.council_decisions;

-- Reads stay public (the existing SELECT policy is left in place).
REVOKE INSERT, UPDATE, DELETE ON public.council_decisions FROM anon, authenticated;

GRANT SELECT ON public.council_decisions TO anon, authenticated;
GRANT ALL ON public.council_decisions TO service_role;