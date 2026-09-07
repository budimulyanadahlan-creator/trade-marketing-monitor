-- 036: Seed vendor master data dari "SAP Vendor Database.xlsx" sheet Marmotz
-- Sumber: D:\Area\Hobby\Trade Marketing Monitor Dashboard V2\SAP Vendor Database.xlsx
-- Hanya sheet Marmotz (name, contact, service_category) yang diimport -- kolomnya
-- persis cocok dengan tabel vendors yang ada. Sheet SAP (BP code, alamat, NPWP,
-- rekening bank) sengaja tidak diimport karena field tsb belum ada di skema.
-- Kategori layanan dibiarkan kosong untuk 18/20 vendor yang memang kosong di sumber.
-- Aman dijalankan ulang: setiap insert dijaga "where not exists" per nama.

begin;

insert into public.vendors (name, contact, service_category)
select 'August', '+62 812-3200-3614', 'Agency Digital'
where not exists (select 1 from public.vendors where name = 'August');

insert into public.vendors (name, contact, service_category)
select 'Hello Design', '+62 817-4901-922', null
where not exists (select 1 from public.vendors where name = 'Hello Design');

insert into public.vendors (name, contact, service_category)
select 'Doxadigital', '+62 822-9784-6909', null
where not exists (select 1 from public.vendors where name = 'Doxadigital');

insert into public.vendors (name, contact, service_category)
select 'DGTraffic', '+62 896-3178-3194', null
where not exists (select 1 from public.vendors where name = 'DGTraffic');

insert into public.vendors (name, contact, service_category)
select 'Benih Sakti Makmur', '+62 877-3200-5630', 'POSM'
where not exists (select 1 from public.vendors where name = 'Benih Sakti Makmur');

insert into public.vendors (name, contact, service_category)
select 'Bolia Mitra Utama', '+62 818-193-672', null
where not exists (select 1 from public.vendors where name = 'Bolia Mitra Utama');

insert into public.vendors (name, contact, service_category)
select 'Cassana Pop Jaya', '+62 812-1771-7868', null
where not exists (select 1 from public.vendors where name = 'Cassana Pop Jaya');

insert into public.vendors (name, contact, service_category)
select 'Cipta Dwi Mandiri/Zettprint', '+62 858-6720-5741', null
where not exists (select 1 from public.vendors where name = 'Cipta Dwi Mandiri/Zettprint');

insert into public.vendors (name, contact, service_category)
select 'Flexiprint', '+62 813-8888-1773', null
where not exists (select 1 from public.vendors where name = 'Flexiprint');

insert into public.vendors (name, contact, service_category)
select 'Jitu', '+62 812-2661-0168', null
where not exists (select 1 from public.vendors where name = 'Jitu');

insert into public.vendors (name, contact, service_category)
select 'Kreasindo Cipta Ragam', '+62 856-6877-6168', null
where not exists (select 1 from public.vendors where name = 'Kreasindo Cipta Ragam');

insert into public.vendors (name, contact, service_category)
select 'Mitra Anugerah', '+62 813-6604-7888', null
where not exists (select 1 from public.vendors where name = 'Mitra Anugerah');

insert into public.vendors (name, contact, service_category)
select 'Nilam Sukses Mandiri', '+62 813-6245-5908', null
where not exists (select 1 from public.vendors where name = 'Nilam Sukses Mandiri');

insert into public.vendors (name, contact, service_category)
select 'Polaris', '+62 857-1055-2323', null
where not exists (select 1 from public.vendors where name = 'Polaris');

insert into public.vendors (name, contact, service_category)
select 'Spunbound', '+62 811-9303-030', null
where not exists (select 1 from public.vendors where name = 'Spunbound');

insert into public.vendors (name, contact, service_category)
select 'Putra Surya Group', '+62 853-7003-8485', null
where not exists (select 1 from public.vendors where name = 'Putra Surya Group');

insert into public.vendors (name, contact, service_category)
select 'DMK', '+62 822-4962-7526', null
where not exists (select 1 from public.vendors where name = 'DMK');

insert into public.vendors (name, contact, service_category)
select 'Meteora', '+62 857-4821-243', null
where not exists (select 1 from public.vendors where name = 'Meteora');

insert into public.vendors (name, contact, service_category)
select 'Zalfinto', '+62 812-9507-3473', null
where not exists (select 1 from public.vendors where name = 'Zalfinto');

insert into public.vendors (name, contact, service_category)
select 'Pratama Putera Sukses', '+62 813-9869-846', null
where not exists (select 1 from public.vendors where name = 'Pratama Putera Sukses');

commit;
