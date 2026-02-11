import { supabase } from './supabase';
import { pinDb, LocalMessage } from './db';

let currentUserId: string | null = null;

export const syncService = {
    myPin: null as string | null,

    // Helper: Auth and set currentUserId
    async connect(pin: string): Promise<string | null> {
        this.myPin = pin;
        const email = `${pin.toLowerCase()}@pinchat.app`;
        const password = `pin_${pin}_secure`;

        try {
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });

            if (error) {
                // Try signup if login fails
                const { data: sData, error: sError } = await supabase.auth.signUp({
                    email,
                    password,
                    options: { data: { pin_id: pin } }
                });
                if (sError) {
                    console.warn('[SYNC] Sign up failed (might be email confirmation required):', sError);
                    return null;
                }
                currentUserId = sData.user?.id || null;
            } else {
                currentUserId = data.user?.id || null;
            }
            return currentUserId;
        } catch (e) {
            console.error('[SYNC] Connection error:', e);
            return null;
        }
    },

    // 1. Send Message to Cloud (WHOAPP Schema)
    async sendMessage(msg: LocalMessage, senderPin: string) {
        let userId = currentUserId;
        if (!userId) {
            userId = await this.connect(senderPin);
        }

        // --- AUTH BYPASS FOR DEMO ---
        // If still no userId (blocked by email confirm), use deterministic ghost UUID
        if (!userId) {
            userId = `00000000-0000-0000-0000-${senderPin.padEnd(12, '0')}`;
        }

        try {
            const chatId = await this.ensureChat(msg.channelId);

            const { error } = await supabase
                .from('messages')
                .insert({
                    chat_id: chatId,
                    sender_id: userId,
                    content: msg.encryptedContent,
                    type: this.mapMediaType(msg.mediaType),
                    media_url: msg.mediaUrl
                });

            if (error) throw error;
            await pinDb.updateMessageStatus(msg.id, 'delivered');
        } catch (e: any) {
            console.error('[SYNC] Send failed:', e);
        }
    },

    // 2. Subscribe (Real-time)
    subscribeToChannel(localChannelId: string, onMessage: (msg: LocalMessage) => void, onStatus?: (status: string, chatId?: string) => void) {
        let realSubscription: any = null;
        let isUnsubscribed = false;

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
                    // Ignore own messages (we use dummy IDs possibly, so check against current ghost ID too)
                    const ghostId = `00000000-0000-0000-0000-${this.myPin?.padEnd(12, '0')}`;
                    if (newMsg.sender_id === currentUserId || newMsg.sender_id === ghostId) return;

                    const localMsg: LocalMessage = {
                        id: newMsg.id,
                        channelId: localChannelId,
                        bucketId: 0,
                        senderPin: 'CLOUD_USER',
                        content: '[ENCRIPTADO]',
                        encryptedContent: newMsg.content,
                        mediaType: (newMsg.type === 'image' ? 'image' : 'text') as any,
                        mediaUrl: newMsg.media_url,
                        expiresAt: Date.now() + 86400000,
                        createdAt: new Date(newMsg.created_at).getTime(),
                        status: 'delivered',
                        syncedAt: Date.now()
                    };

                    onMessage(localMsg);
                })
                .subscribe((status) => {
                    if (onStatus) onStatus(status, chatId);
                });

            realSubscription = channel;
        }).catch(() => {
            if (onStatus) onStatus('ERROR_SETUP');
        });

        return {
            unsubscribe: () => {
                isUnsubscribed = true;
                if (realSubscription) realSubscription.unsubscribe();
            }
        };
    },

    // Helper: Find or Create Cloud Chat
    async ensureChat(localChannelId: string): Promise<string> {
        let userId = currentUserId;
        if (!userId && this.myPin) {
            userId = `00000000-0000-0000-0000-${this.myPin.padEnd(12, '0')}`;
        }

        const { data: existing } = await supabase
            .from('chats')
            .select('id')
            .eq('name', localChannelId)
            .maybeSingle();

        let chatId = existing?.id;

        if (!chatId) {
            const { data: newChat, error } = await supabase
                .from('chats')
                .insert({ name: localChannelId, is_group: false })
                .select('id')
                .single();
            if (error) throw error;
            chatId = newChat.id;
        }

        // Join as participant
        if (userId && chatId) {
            await supabase
                .from('chat_participants')
                .upsert({ chat_id: chatId, user_id: userId }, { onConflict: 'chat_id,user_id' });
        }

        return chatId;
    },

    mapMediaType(local: string): string {
        if (local === 'image') return 'image';
        return 'text';
    },

    async pullMissedMessages(localChannelId: string) {
        try {
            const chatId = await this.ensureChat(localChannelId);
            const { data } = await supabase
                .from('messages')
                .select('*')
                .eq('chat_id', chatId)
                .order('created_at', { ascending: false })
                .limit(20);

            if (data) {
                // Sync to local DB logic (omitted for brevity, assume manual refresh)
            }
        } catch (e) {
            console.warn('[SYNC] History pull failed');
        }
    }
};
