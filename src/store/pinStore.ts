/**
 * PIN Global State Store — Zustand
 */

import { create } from 'zustand';
import { LocalMessage, LocalChannel } from '@/lib/db';

interface UserIdentity {
    pin: string;
    userId: string | null;
    identityKeyPub: string;
    isAuthenticated: boolean;
}

interface PinStore {
    // Identity
    identity: UserIdentity | null;
    setIdentity: (identity: UserIdentity | null) => void;

    // Connection
    connectionStatus: 'active' | 'queued' | 'offline' | 'connecting';
    setConnectionStatus: (status: PinStore['connectionStatus']) => void;

    // Channels
    channels: LocalChannel[];
    setChannels: (channels: LocalChannel[]) => void;
    updateChannel: (channelId: string, updates: Partial<LocalChannel>) => void;

    // Active Chat
    activeChannelId: string | null;
    setActiveChannelId: (id: string | null) => void;

    // Messages (for active channel)
    messages: LocalMessage[];
    setMessages: (messages: LocalMessage[]) => void;
    addMessage: (message: LocalMessage) => void;
    updateMessageStatus: (id: string, status: LocalMessage['status']) => void;

    // UI State
    isTyping: boolean;
    setIsTyping: (typing: boolean) => void;
    showNewChat: boolean;
    setShowNewChat: (show: boolean) => void;

    // Navigation
    currentScreen: 'vault' | 'chats' | 'conversation' | 'settings';
    setCurrentScreen: (screen: PinStore['currentScreen']) => void;

    // Online status
    isOnline: boolean;
    setIsOnline: (online: boolean) => void;

    // Encryption verification
    verificationStatus: 'idle' | 'verifying' | 'verified' | 'failed';
    setVerificationStatus: (status: PinStore['verificationStatus']) => void;
}

export const usePinStore = create<PinStore>((set) => ({
    // Identity
    identity: null,
    setIdentity: (identity) => set({ identity }),

    // Connection
    connectionStatus: 'offline',
    setConnectionStatus: (connectionStatus) => set({ connectionStatus }),

    // Channels
    channels: [],
    setChannels: (channels) => set({ channels }),
    updateChannel: (channelId, updates) =>
        set((state) => ({
            channels: state.channels.map((ch) =>
                ch.id === channelId ? { ...ch, ...updates } : ch
            ),
        })),

    // Active Chat
    activeChannelId: null,
    setActiveChannelId: (activeChannelId) => set({ activeChannelId }),

    // Messages
    messages: [],
    setMessages: (messages) => set({ messages }),
    addMessage: (message) =>
        set((state) => ({
            messages: [...state.messages, message],
        })),
    updateMessageStatus: (id, status) =>
        set((state) => ({
            messages: state.messages.map((msg) =>
                msg.id === id ? { ...msg, status } : msg
            ),
        })),

    // UI
    isTyping: false,
    setIsTyping: (isTyping) => set({ isTyping }),
    showNewChat: false,
    setShowNewChat: (showNewChat) => set({ showNewChat }),

    // Navigation
    currentScreen: 'vault',
    setCurrentScreen: (currentScreen) => set({ currentScreen }),

    // Online
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    setIsOnline: (isOnline) => set({ isOnline }),

    // Verification
    verificationStatus: 'idle',
    setVerificationStatus: (verificationStatus) => set({ verificationStatus }),
}));
