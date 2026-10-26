-- Baseline: columns and tables that earlier deploys added by hand on Neon. Every statement is guarded,
-- so on the restored Neon copy this migration changes nothing; on an empty schema it fills the gaps.
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_notified_date text;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'ru';
ALTER TABLE expo_push_subscriptions ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'ru';

CREATE TABLE IF NOT EXISTS fcm_push_subscriptions (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  fcm_token text NOT NULL,
  platform text NOT NULL DEFAULT 'android',
  language text NOT NULL DEFAULT 'ru',
  created_at timestamp NOT NULL DEFAULT now()
);
