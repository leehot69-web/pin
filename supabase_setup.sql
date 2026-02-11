-- ==============================================================================
-- PINCHAT + WHOAPP COMPATIBILITY SCHEMA
-- Ejecuta esto en Supabase SQL Editor para asegurar que PinChat funcione.
-- ==============================================================================

-- 1. Asegurar tabla CHATS
create table if not exists chats (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  name text,
  is_group boolean default false
);

-- 2. Asegurar tabla PARTICIPANTS
create table if not exists chat_participants (
  chat_id uuid references chats(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  joined_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (chat_id, user_id)
);

-- 3. Asegurar tabla MESSAGES (compatible con WhoApp)
create table if not exists messages (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  chat_id uuid references chats(id) on delete cascade not null,
  sender_id uuid references auth.users(id) on delete cascade not null,
  content text,
  type text default 'text',
  media_url text,
  file_name text,
  file_size bigint
);

-- ==============================================================================
-- 4. POLÍTICAS DE SEGURIDAD (RLS) - "Permissive Mode" para PinChat
-- ==============================================================================

-- Habilitar RLS
alter table chats enable row level security;
alter table chat_participants enable row level security;
alter table messages enable row level security;

-- CHATS: Cualquiera puede crear un chat. Ver chats donde eres participante.
create policy "Users can select their own chats" on chats
  for select using (
    exists (
      select 1 from chat_participants 
      where chat_participants.chat_id = chats.id 
      and chat_participants.user_id = auth.uid()
    )
    -- Permitir también buscar por nombre si vas a crear uno nuevo (necesario para PinChat ensureChat)
    or (name is not null) 
  );

create policy "Users can insert chats" on chats
  for insert with check (auth.uid() is not null);

-- PARTICIPANTS: Permitir unirse a chats.
create policy "Users can see participants in their chats" on chat_participants
  for select using (
    exists (
      select 1 from chat_participants cp 
      where cp.chat_id = chat_participants.chat_id 
      and cp.user_id = auth.uid()
    )
    -- Permitir ver si YO estoy en el chat (para validación)
    or user_id = auth.uid()
  );

create policy "Users can join chats" on chat_participants
  for insert with check (
    auth.uid() = user_id -- Solo puedo agregarme a mí mismo (auto-join)
    or exists ( -- O si ya estoy en el chat, puedo agregar a otros (opcional, para grupos)
      select 1 from chat_participants cp
      where cp.chat_id = chat_id
      and cp.user_id = auth.uid()
    )
  );

-- MESSAGES: Leer y escribir si estás en el chat.
create policy "Chat participants can see messages" on messages
  for select using (
    exists (
      select 1 from chat_participants 
      where chat_participants.chat_id = messages.chat_id 
      and chat_participants.user_id = auth.uid()
    )
  );

create policy "Chat participants can insert messages" on messages
  for insert with check (
    auth.uid() = sender_id -- El sender debo ser yo
    and exists ( -- Y debo estar en el chat
      select 1 from chat_participants 
      where chat_participants.chat_id = messages.chat_id 
      and chat_participants.user_id = auth.uid()
    )
  );

-- ==============================================================================
-- 5. STORAGE (Opcional, para imágenes)
-- ==============================================================================
insert into storage.buckets (id, name, public) 
values ('chat-media', 'chat-media', true)
on conflict (id) do nothing;

create policy "Public Access" on storage.objects for select using ( bucket_id = 'chat-media' );
create policy "Auth Upload" on storage.objects for insert with check ( bucket_id = 'chat-media' and auth.uid() is not null );
