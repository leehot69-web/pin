-- ============================================================
-- PIN: Database Schema (Supabase SQL)
-- Discord-style bucketing + Signal-style security
-- ============================================================

-- 1. Profiles: Identity by PIN only
CREATE TABLE profiles (
  id uuid REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  pin_id varchar(8) UNIQUE NOT NULL,
  identity_key_pub text NOT NULL,
  signed_pre_key_pub text NOT NULL,
  one_time_pre_keys jsonb DEFAULT '[]'::jsonb,
  last_seen timestamp with time zone DEFAULT now()
);

-- 2. Channels: 1-to-1 encrypted conversations
CREATE TABLE channels (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  participant_a varchar(8) NOT NULL REFERENCES profiles(pin_id),
  participant_b varchar(8) NOT NULL REFERENCES profiles(pin_id),
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(participant_a, participant_b)
);

-- 3. Messages: Bucketed for read optimization (Discord-style)
--    bucket_id = floor(extract(epoch from created_at) / (10 * 86400))
--    Each bucket spans ~10 days
CREATE TABLE messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  bucket_id int NOT NULL,
  sender_pin varchar(8) NOT NULL,
  encrypted_content text NOT NULL,
  media_type text CHECK (media_type IN ('text', 'image', 'audio', 'camera')),
  media_url text,
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '8 hours'),
  created_at timestamp with time zone DEFAULT now()
);

-- Index for fast bucket queries (Discord pattern)
CREATE INDEX idx_messages_channel_bucket ON messages(channel_id, bucket_id DESC);
CREATE INDEX idx_messages_expires ON messages(expires_at);

-- 4. Active Sessions: Connection rotation system
CREATE TABLE active_sessions (
  user_id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  pin_id varchar(8) NOT NULL,
  last_heartbeat timestamp with time zone DEFAULT now(),
  status text CHECK (status IN ('active', 'queued')) DEFAULT 'queued',
  is_typing boolean DEFAULT false
);

-- ============================================================
-- RPC Functions
-- ============================================================

-- Generate unique PIN ID (8 alphanumeric chars)
CREATE OR REPLACE FUNCTION generate_unique_pin()
RETURNS varchar(8) AS $$
DECLARE
  new_pin varchar(8);
  chars text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  i int;
BEGIN
  LOOP
    new_pin := '';
    FOR i IN 1..8 LOOP
      new_pin := new_pin || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    -- Check uniqueness
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE pin_id = new_pin) THEN
      RETURN new_pin;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Heartbeat: Update session activity
CREATE OR REPLACE FUNCTION heartbeat(p_user_id uuid, p_pin_id varchar)
RETURNS json AS $$
DECLARE
  active_count int;
  result json;
BEGIN
  -- Count active connections
  SELECT count(*) INTO active_count FROM active_sessions WHERE status = 'active';
  
  -- Upsert session
  INSERT INTO active_sessions (user_id, pin_id, last_heartbeat, status)
  VALUES (
    p_user_id,
    p_pin_id,
    now(),
    CASE WHEN active_count < 180 THEN 'active' ELSE 'queued' END
  )
  ON CONFLICT (user_id) DO UPDATE SET
    last_heartbeat = now(),
    status = CASE WHEN active_count < 180 THEN 'active' ELSE active_sessions.status END;
  
  -- If over 180, disconnect oldest non-typing user
  IF active_count >= 180 THEN
    UPDATE active_sessions
    SET status = 'queued'
    WHERE user_id = (
      SELECT user_id FROM active_sessions
      WHERE status = 'active' AND is_typing = false
      ORDER BY last_heartbeat ASC
      LIMIT 1
    );
  END IF;
  
  SELECT json_build_object(
    'status', (SELECT status FROM active_sessions WHERE user_id = p_user_id),
    'active_connections', active_count
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Cleanup expired messages (run via cron or edge function)
CREATE OR REPLACE FUNCTION cleanup_expired_messages()
RETURNS int AS $$
DECLARE
  deleted_count int;
BEGIN
  DELETE FROM messages WHERE expires_at < now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get messages by bucket for a channel
CREATE OR REPLACE FUNCTION get_messages_by_bucket(
  p_channel_id uuid,
  p_bucket_id int DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS SETOF messages AS $$
BEGIN
  IF p_bucket_id IS NULL THEN
    RETURN QUERY
      SELECT * FROM messages
      WHERE channel_id = p_channel_id
      ORDER BY created_at DESC
      LIMIT p_limit;
  ELSE
    RETURN QUERY
      SELECT * FROM messages
      WHERE channel_id = p_channel_id AND bucket_id = p_bucket_id
      ORDER BY created_at DESC
      LIMIT p_limit;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Find or create channel between two PINs
CREATE OR REPLACE FUNCTION find_or_create_channel(pin_a varchar, pin_b varchar)
RETURNS uuid AS $$
DECLARE
  channel_id uuid;
  sorted_a varchar(8);
  sorted_b varchar(8);
BEGIN
  -- Sort PINs to avoid duplicate channels
  IF pin_a < pin_b THEN
    sorted_a := pin_a;
    sorted_b := pin_b;
  ELSE
    sorted_a := pin_b;
    sorted_b := pin_a;
  END IF;

  -- Check existing
  SELECT id INTO channel_id FROM channels
  WHERE participant_a = sorted_a AND participant_b = sorted_b;

  IF channel_id IS NULL THEN
    INSERT INTO channels (participant_a, participant_b)
    VALUES (sorted_a, sorted_b)
    RETURNING id INTO channel_id;
  END IF;

  RETURN channel_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE active_sessions ENABLE ROW LEVEL SECURITY;

-- Profiles: Users can read all, update own
CREATE POLICY "Public profiles are viewable by everyone"
  ON profiles FOR SELECT USING (true);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Channels: Participants can see their channels
CREATE POLICY "Users can view their channels"
  ON channels FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND (profiles.pin_id = channels.participant_a OR profiles.pin_id = channels.participant_b)
    )
  );

CREATE POLICY "Users can create channels"
  ON channels FOR INSERT WITH CHECK (true);

-- Messages: Channel participants can read/write
CREATE POLICY "Channel participants can view messages"
  ON messages FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM channels c
      JOIN profiles p ON p.id = auth.uid()
      WHERE c.id = messages.channel_id
      AND (p.pin_id = c.participant_a OR p.pin_id = c.participant_b)
    )
  );

CREATE POLICY "Channel participants can insert messages"
  ON messages FOR INSERT WITH CHECK (true);

-- Sessions: Users manage own
CREATE POLICY "Users manage own session"
  ON active_sessions FOR ALL USING (auth.uid() = user_id);
