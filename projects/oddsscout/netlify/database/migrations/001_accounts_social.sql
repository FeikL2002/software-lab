-- Preview account data is private by default. Identity IDs are verified server-side, never client supplied.
-- This new schema contains no imported production data or seeded people, messages, wins or likes.
CREATE TABLE oddsscout_profiles (
 user_id text PRIMARY KEY,
 display_name varchar(32) NOT NULL,
 winnings_public boolean NOT NULL DEFAULT false,
 created_at timestamptz(3) NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE oddsscout_bets (
 id uuid PRIMARY KEY,
 user_id text NOT NULL,
 record jsonb NOT NULL,
 status text NOT NULL CHECK (status IN ('saved','open','won','lost','push','void','cashout')),
 stake_cents bigint CHECK (stake_cents BETWEEN 1 AND 10000000),
 return_cents bigint CHECK (return_cents BETWEEN 0 AND 10000000000),
 version integer NOT NULL DEFAULT 1 CHECK (version>0),
 created_at timestamptz(3) NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((status='saved' AND stake_cents IS NULL AND return_cents IS NULL) OR
        (status='open' AND stake_cents IS NOT NULL AND return_cents IS NULL) OR
        (status IN ('won','lost','push','void','cashout') AND stake_cents IS NOT NULL AND return_cents IS NOT NULL)),
 CHECK (record->>'mode'='real'),
 CHECK (record->>'id'=id::text),
 CHECK (record->>'status'=status)
);
CREATE INDEX oddsscout_bets_owner_history ON oddsscout_bets(user_id,created_at DESC,id DESC);
CREATE TABLE oddsscout_likes (
 selection_hash char(64) NOT NULL,
 user_id text NOT NULL,
 event_id varchar(150) NOT NULL,
 title varchar(1000) NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT now(),
 PRIMARY KEY(selection_hash,user_id)
);
CREATE INDEX oddsscout_likes_recent ON oddsscout_likes(created_at DESC);
CREATE TABLE oddsscout_chat (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id text NOT NULL,
 body varchar(1000) NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT now(),
 deleted_at timestamptz
);
CREATE INDEX oddsscout_chat_page ON oddsscout_chat(created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX oddsscout_chat_cooldown ON oddsscout_chat(user_id,created_at DESC);
CREATE TABLE oddsscout_chat_reports (
 message_id uuid NOT NULL REFERENCES oddsscout_chat(id) ON DELETE CASCADE,
 user_id text NOT NULL,
 reason varchar(300) NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT now(),
 PRIMARY KEY(message_id,user_id)
);
-- These tables have no browser-facing database gateway. Only verified server Functions query them.
REVOKE ALL ON oddsscout_profiles,oddsscout_bets,oddsscout_likes,oddsscout_chat,oddsscout_chat_reports FROM PUBLIC;
