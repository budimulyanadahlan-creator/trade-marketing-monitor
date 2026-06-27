CREATE OR REPLACE FUNCTION public.increment_skp_counter(p_year INT, p_month INT)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_sequence INT;
BEGIN
  INSERT INTO public.skp_number_counters(year, month, last_sequence)
  VALUES (p_year, p_month, 1)
  ON CONFLICT (year, month)
  DO UPDATE SET last_sequence = public.skp_number_counters.last_sequence + 1
  RETURNING last_sequence INTO v_sequence;

  RETURN v_sequence;
END;
$$;
