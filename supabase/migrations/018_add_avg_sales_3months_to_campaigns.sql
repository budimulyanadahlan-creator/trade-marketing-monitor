-- Migration 018: Tambah kolom rata-rata penjualan 3 bulan terakhir ke tabel campaigns
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS avg_sales_3months bigint NOT NULL DEFAULT 0;
