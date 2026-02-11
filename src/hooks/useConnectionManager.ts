/**
 * useConnectionManager — Active Lease System for Supabase Realtime
 * 
 * Manages the 200 concurrent connection limit by:
 * - Heartbeat every 30 seconds (active)
 * - Auto-switching to polling when tab loses focus
 * - Graceful disconnect when queued
 */

'use client';

import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { usePinStore } from '@/store/pinStore';
import { pinDb } from '@/lib/db';
import type { RealtimeChannel } from '@supabase/supabase-js';

const HEARTBEAT_INTERVAL = 30_000; // 30 seconds
const POLL_INTERVAL = 120_000; // 2 minutes (background)
const EXPIRY_CHECK_INTERVAL = 60_000; // 1 minute

export function useConnectionManager() {
    const {
        identity,
        connectionStatus,
        setConnectionStatus,
        activeChannelId,
        setIsOnline,
        addMessage,
    } = usePinStore();

    const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const expiryRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const channelRef = useRef<RealtimeChannel | null>(null);
    const isVisibleRef = useRef(true);

    // ---- Heartbeat ----
    const sendHeartbeat = useCallback(async () => {
        if (!identity?.userId || !identity?.pin) return;

        try {
            const { data, error } = await supabase.rpc('heartbeat', {
                p_user_id: identity.userId,
                p_pin_id: identity.pin,
            });

            if (error) {
                console.warn('[PIN] Heartbeat error:', error);
                setConnectionStatus('offline');
                return;
            }

            const status = data?.status || 'queued';
            setConnectionStatus(status);

            // If queued, unsubscribe from realtime
            if (status === 'queued' && channelRef.current) {
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
            }
        } catch {
            setConnectionStatus('offline');
        }
    }, [identity, setConnectionStatus]);

    // ---- Realtime Subscription ----
    const subscribeToChannel = useCallback(
        (channelId: string) => {
            // Clean up existing subscription
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
            }

            if (connectionStatus !== 'active') return;

            const channel = supabase
                .channel(`messages:${channelId}`)
                .on(
                    'postgres_changes',
                    {
                        event: 'INSERT',
                        schema: 'public',
                        table: 'messages',
                        filter: `channel_id=eq.${channelId}`,
                    },
                    async (payload) => {
                        const msg = payload.new;
                        // Store in IndexedDB and update state
                        const localMsg = {
                            id: String(msg.id),
                            channelId: msg.channel_id,
                            bucketId: msg.bucket_id,
                            senderPin: msg.sender_pin,
                            content: msg.encrypted_content, // will be decrypted by the component
                            encryptedContent: msg.encrypted_content,
                            mediaType: msg.media_type,
                            mediaUrl: msg.media_url,
                            expiresAt: new Date(msg.expires_at).getTime(),
                            createdAt: new Date(msg.created_at).getTime(),
                            status: 'delivered' as const,
                            syncedAt: Date.now(),
                        };

                        await pinDb.addMessageDirect(localMsg);
                        addMessage(localMsg);
                    }
                )
                .subscribe();

            channelRef.current = channel;
        },
        [connectionStatus, addMessage]
    );

    // ---- Polling (background mode) ----
    const pollForMessages = useCallback(async () => {
        if (!activeChannelId) return;

        try {
            const lastSync = await pinDb.getLastSyncTime(activeChannelId);

            const { data: newMessages } = await supabase
                .from('messages')
                .select('*')
                .eq('channel_id', activeChannelId)
                .gt('created_at', new Date(lastSync).toISOString())
                .order('created_at', { ascending: true })
                .limit(100);

            if (newMessages && newMessages.length > 0) {
                for (const msg of newMessages) {
                    const localMsg = {
                        id: String(msg.id),
                        channelId: msg.channel_id,
                        bucketId: msg.bucket_id,
                        senderPin: msg.sender_pin,
                        content: msg.encrypted_content,
                        encryptedContent: msg.encrypted_content,
                        mediaType: msg.media_type,
                        mediaUrl: msg.media_url,
                        expiresAt: new Date(msg.expires_at).getTime(),
                        createdAt: new Date(msg.created_at).getTime(),
                        status: 'delivered' as const,
                        syncedAt: Date.now(),
                    };
                    await pinDb.addMessageDirect(localMsg);
                    addMessage(localMsg);
                }

                await pinDb.setLastSyncTime(
                    activeChannelId,
                    new Date(newMessages[newMessages.length - 1].created_at).getTime()
                );
            }
        } catch (err) {
            console.warn('[PIN] Poll error:', err);
        }
    }, [activeChannelId, addMessage]);

    // ---- Cleanup Expired Messages ----
    const cleanupExpired = useCallback(async () => {
        const deleted = await pinDb.deleteExpiredMessages();
        if (deleted > 0) {
            console.log(`[PIN] Cleaned up ${deleted} expired messages`);
        }
    }, []);

    // ---- Visibility Change ----
    useEffect(() => {
        const handleVisibility = () => {
            isVisibleRef.current = document.visibilityState === 'visible';

            if (isVisibleRef.current) {
                // Foreground: switch to Realtime
                sendHeartbeat();
                if (activeChannelId && connectionStatus === 'active') {
                    subscribeToChannel(activeChannelId);
                }
                // Clear polling
                if (pollRef.current) {
                    clearInterval(pollRef.current);
                    pollRef.current = null;
                }
            } else {
                // Background: switch to Polling
                if (channelRef.current) {
                    supabase.removeChannel(channelRef.current);
                    channelRef.current = null;
                }
                pollRef.current = setInterval(pollForMessages, POLL_INTERVAL);
            }
        };

        document.addEventListener('visibilitychange', handleVisibility);
        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, [sendHeartbeat, subscribeToChannel, pollForMessages, activeChannelId, connectionStatus]);

    // ---- Online / Offline ----
    useEffect(() => {
        const handleOnline = () => {
            setIsOnline(true);
            sendHeartbeat();
            // Sync pending messages
            syncPendingMessages();
        };
        const handleOffline = () => {
            setIsOnline(false);
            setConnectionStatus('offline');
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [sendHeartbeat, setIsOnline, setConnectionStatus]);

    // ---- Sync Pending Messages ----
    const syncPendingMessages = useCallback(async () => {
        const pending = await pinDb.getPendingMessages();
        for (const msg of pending) {
            try {
                const { error } = await supabase.from('messages').insert({
                    channel_id: msg.channelId,
                    bucket_id: msg.bucketId,
                    sender_pin: msg.senderPin,
                    encrypted_content: msg.encryptedContent,
                    media_type: msg.mediaType,
                    media_url: msg.mediaUrl,
                });

                if (!error) {
                    await pinDb.updateMessageStatus(msg.id, 'sent');
                }
            } catch {
                console.warn('[PIN] Failed to sync message:', msg.id);
            }
        }
    }, []);

    // ---- Start Heartbeat ----
    useEffect(() => {
        if (!identity) return;

        sendHeartbeat();
        heartbeatRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

        // Start expiry cleanup
        expiryRef.current = setInterval(cleanupExpired, EXPIRY_CHECK_INTERVAL);

        return () => {
            if (heartbeatRef.current) clearInterval(heartbeatRef.current);
            if (pollRef.current) clearInterval(pollRef.current);
            if (expiryRef.current) clearInterval(expiryRef.current);
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
            }
        };
    }, [identity, sendHeartbeat, cleanupExpired]);

    // ---- Subscribe to active channel ----
    useEffect(() => {
        if (activeChannelId && connectionStatus === 'active' && isVisibleRef.current) {
            subscribeToChannel(activeChannelId);
        }
    }, [activeChannelId, connectionStatus, subscribeToChannel]);

    return {
        sendHeartbeat,
        syncPendingMessages,
        connectionStatus,
    };
}
