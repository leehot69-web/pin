import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Profile = {
  id: string;
  pin_id: string;
  identity_key_pub: string;
  signed_pre_key_pub: string;
  last_seen: string | null;
};

export type Message = {
  id: string;
  channel_id: string;
  bucket_id: number;
  sender_pin: string;
  encrypted_content: string;
  media_type: 'text' | 'image' | 'audio' | 'camera' | null;
  media_url: string | null;
  expires_at: string;
  created_at: string;
};

export type Channel = {
  id: string;
  participant_a: string;
  participant_b: string;
  created_at: string;
};

export type ActiveSession = {
  user_id: string;
  last_heartbeat: string;
  status: 'active' | 'queued';
  is_typing: boolean;
};
