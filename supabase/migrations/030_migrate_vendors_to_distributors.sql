-- 030: Migrasi data vendor ke distributor
-- Entri master Vendors yang sebenarnya perusahaan distributor dipindahkan ke master Distributors,
-- dan SKP lama yang menunjuknya dialihkan dari vendor_id ke distributor_id.
-- Daftar dikonfirmasi user: Bintang Indo Raya, Esham Dima, Mitra Monas Sejahtera.
-- Ditambah entri baru "Arta Jaya Semesta" yang belum pernah ada di Vendors.
-- Aman dijalankan ulang: setelah run pertama, nama-nama ini sudah tidak ada di vendors
-- sehingga insert/update lanjutan menjadi no-op; step 4 dijaga dengan not exists.

begin;

-- 1. Salin entri terdaftar dari vendors ke distributors
insert into public.distributors (name, contact, is_active)
select name, contact, is_active
from public.vendors
where name in ('Bintang Indo Raya', 'Esham Dima', 'Mitra Monas Sejahtera');

-- 2. Alihkan referensi SKP: distributor_id terisi, vendor_id dikosongkan
update public.campaigns c
set distributor_id = d.id,
    vendor_id = null
from public.vendors v
join public.distributors d on d.name = v.name
where c.vendor_id = v.id
  and v.name in ('Bintang Indo Raya', 'Esham Dima', 'Mitra Monas Sejahtera');

-- 3. Hapus entri lama dari vendors
delete from public.vendors
where name in ('Bintang Indo Raya', 'Esham Dima', 'Mitra Monas Sejahtera');

-- 4. Tambahkan distributor baru yang belum pernah ada di Vendors
insert into public.distributors (name, contact, is_active)
select 'Arta Jaya Semesta', null, true
where not exists (
  select 1 from public.distributors where name = 'Arta Jaya Semesta'
);

commit;
