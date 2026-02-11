
import { supabase } from './supabase';
import { pinDb, LocalMessage } from './db';

// ========== SUPABASE SYNC SERVICE (Adapted for WHOAPP Schema) ==========

let currentUserId: string | null = null;

export const syncService = {

    // 0. Auth / Connect (Silent Login based on PIN)
    async connect(pin: string) {
        if (currentUserId) return currentUserId;

        const email = `${pin.toLowerCase()}@pinchat.app`;
        const password = `pin-secure-${pin}-2024`;

        // 1. Try Login
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (data.user) {
            currentUserId = data.user.id;
            return currentUserId;
        }

        // 2. If fail, Try Register
        if (error) {
            console.log('[SYNC] Creating new cloud identity...');
            const { data: regData, error: regError } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        username: `PIN-${pin}`,
                        full_name: `PIN User ${pin}`,
                        avatar_url: `https://api.dicebear.com/7.x/shapes/svg?seed=${pin}`
                    }
                }
            });

            if (regError) {
                console.error('[SYNC] Auth failed:', regError);
                return null;
            }
            if (regData.user) {
                currentUserId = regData.user.id;
                return currentUserId;
            }
        }
        return null;
    },

    // 1. Send Message to Cloud (WHOAPP Schema)
    async sendMessage(msg: LocalMessage, senderPin: string) {
        const userId = await this.connect(senderPin);
        if (!userId) return; // Cannot send if not auth

        try {
            // Map PIN-Channel-ID string to a UUID chat_id
            // Logic: Lookup 'chats' table where name = channelId OR create it
            // For simplicity in this demo, we assume the user has joined a chat manually or we create one on fly

            const chatId = await this.ensureChat(msg.channelId);

            const { error } = await supabase
                .from('messages') // WHOAPP table
                .insert({
                    chat_id: chatId,
                    sender_id: userId,
                    content: msg.encryptedContent, // Storing encrypted content in 'content'
                    type: this.mapMediaType(msg.mediaType),
                    media_url: msg.mediaUrl
                });

            if (error) throw error;

            console.log('[SYNC] Sent to cloud:', msg.id);
            await pinDb.updateMessageStatus(msg.id, 'delivered'); // Mark as synced

        } catch (e: any) {
            console.error('[SYNC] Send failed:', e);
            alert(`CLOUD ERROR: ${e.message || 'Unknown'}`);
        }
    },

    // Helper: Find or Create Cloud Chat UUID from Local PIN-Channel
    async ensureChat(localChannelId: string): Promise<string> {
        let chatId: string | null = null;

        // Try finding chat by name (we use pin-pair as name)
        const { data: existing } = await supabase
            .from('chats')
            .select('id')
            .eq('name', localChannelId)
            .single();

        if (existing) {
            chatId = existing.id;
        } else {
            // Create new
            const { data: newChat, error } = await supabase
                .from('chats')
                .insert({
                    name: localChannelId,
                    is_group: false // 1-on-1 logic
                })
                .select('id')
                .single();

            if (error || !newChat) {
                console.error('[SYNC] Create Chat Fail', error);
                throw new Error('Cloud chat creation failed');
            }
            chatId = newChat.id;
        }

        // Join the chat automatically (ALWAYS TRY TO JOIN)
        if (currentUserId && chatId) {
            // Use upsert or ignore error if already joined
            await supabase.from('chat_participants').upsert({
                chat_id: chatId,
                user_id: currentUserId
            }, { onConflict: 'chat_id,user_id', ignoreDuplicates: true });
        }

        return chatId!;
    },

    mapMediaType(type: string | null): string {
        if (!type || type === 'text') return 'text';
        if (type === 'image') return 'image';
        if (type === 'audio') return 'audio';
        if (type === 'video') return 'video';
        return 'text'; // Fallback for 'product', etc.
    },

    // 2. Subscribe
    subscribeToChannel(localChannelId: string, onMessage: (msg: LocalMessage) => void, onStatus?: (status: string, chatId?: string) => void) {
        let realSubscription: { unsubscribe: () => void } | null = null;
        let isUnsubscribed = false;

        // We need the UUID first
        this.ensureChat(localChannelId).then(chatId => {
            if (isUnsubscribed || !chatId) {
                if (onStatus) onStatus('ABORTED_NO_CHAT');
                return;
            }

            if (onStatus) onStatus('CONNECTING', chatId);

            const channel = supabase
                .channel(`room:${chatId}`)
                .on('postgres_changes', {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages',
                    filter: `chat_id=eq.${chatId}`
                }, (payload) => {
                    const newMsg = payload.new;
                    if (newMsg.sender_id === currentUserId) return; // Ignore own echoes

                    // Convert WHOAPP -> LOCAL
                    const localMsg: LocalMessage = {
                        id: newMsg.id,
                        channelId: localChannelId, // Keep local ID
                        bucketId: 0,
                        senderPin: 'CLOUD_USER', // We don't know their PIN easily without lookup, using placeholder
                        content: '[ENCRIPTADO]',
                        encryptedContent: newMsg.content, // We stored it here
                        mediaType: newMsg.type as any,
                        mediaUrl: newMsg.media_url,
                        expiresAt: Date.now() + 86400000,
                        createdAt: new Date(newMsg.created_at).getTime(),
                        status: 'delivered',
                        syncedAt: Date.now()
                    };

                    onMessage(localMsg);
                })
                .subscribe((status) => {
                    console.log(`[SYNC] Subscription status for ${chatId}:`, status);
                    if (onStatus) onStatus(status, chatId);
                });

            realSubscription = channel;
        }).catch(err => {
            console.error('[SYNC] Subscribe setup failed:', err);
            if (onStatus) onStatus('ERROR_SETUP');
        });

        return {
            unsubscribe: () => {
                isUnsubscribed = true;
                if (realSubscription) realSubscription.unsubscribe();
            }
        };
    },

    // 3. Pull Missed
    async pullMissedMessages(localChannelId: string) {
        if (!currentUserId) return;
        const chatId = await this.ensureChat(localChannelId);

        const { data } = await supabase
            .from('messages')
            .select('*')
            .eq('chat_id', chatId)
            .order('created_at', { ascending: false })
            .limit(20);

        if (data) {
            // Process reverse to maintain order
            for (const m of data.reverse()) {
                // Logic to add to local DB if not exists...
            }
        }
    }
};
