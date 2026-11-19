-- Once-a-minute scheduler for reminders (Vercel's free plan only allows a daily cron).
-- Supabase calls the app's reminder endpoint every minute; the endpoint plans and delivers whatever is due.
-- The bearer token is NOT in this file: store it once with
--   select vault.create_secret('<same value as CRON_SECRET in Vercel>', 'cron_secret');
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'founder-os-reminders',
  '* * * * *',
  $job$
  select net.http_get(
    url := 'https://founder-os-gilt-iota.vercel.app/api/cron/reminders',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)),
    timeout_milliseconds := 25000
  );
  $job$
);
