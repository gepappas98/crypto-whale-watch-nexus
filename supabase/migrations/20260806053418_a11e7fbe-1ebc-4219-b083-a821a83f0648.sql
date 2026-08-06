CREATE TABLE public.council_decisions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  token_id TEXT,
  depth TEXT NOT NULL DEFAULT 'standard',
  final_verdict TEXT NOT NULL,
  conviction INTEGER NOT NULL DEFAULT 0,
  decision JSONB NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  transcript JSONB NOT NULL DEFAULT '[]'::jsonb,
  price_at NUMERIC,
  performance JSONB NOT NULL DEFAULT '{}'::jsonb,
  reflection TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX council_decisions_symbol_created_idx ON public.council_decisions (symbol, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.council_decisions TO anon;
GRANT SELECT, INSERT, UPDATE ON public.council_decisions TO authenticated;
GRANT ALL ON public.council_decisions TO service_role;

ALTER TABLE public.council_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Council decisions are publicly readable"
  ON public.council_decisions FOR SELECT USING (true);

CREATE POLICY "Anyone can record a council decision"
  ON public.council_decisions FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update council performance"
  ON public.council_decisions FOR UPDATE USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_council_decisions_updated_at
BEFORE UPDATE ON public.council_decisions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();