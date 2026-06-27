CREATE TABLE public.skp_number_counters (
  year          INT NOT NULL,
  month         INT NOT NULL,
  last_sequence INT NOT NULL DEFAULT 0,
  PRIMARY KEY (year, month)
);

-- Only service_role (server-side actions) should access this table.
-- RLS enabled with no authenticated policies means anon/authenticated cannot read or write.
ALTER TABLE public.skp_number_counters ENABLE ROW LEVEL SECURITY;
