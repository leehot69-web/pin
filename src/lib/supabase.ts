import { createClient } from '@supabase/supabase-js';

// ESTÁTICO: No depende de variables de entorno para evitar errores de red en Vercel
const supabaseUrl = 'https://dsfeibnvihpvobtlkewz.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzZmVpYm52aWhwdm9idGxrZXd6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzOTY2MzEsImV4cCI6MjA4NDk3MjYzMX0.iZYLiyoCb85NAYxGtw_eDqUAYRPUFIDIGK8hFLHL160';

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
