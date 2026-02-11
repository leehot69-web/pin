/**
 * PIN IndexedDB Service — Offline-First Storage
 * 
 * Implements:
 * - LSM-Tree inspired write pattern (Write-Ahead Log + batch flush)
 * - Channel-bucketed message storage (Discord pattern)
 * - Delta sync on reconnection
 * - Secure key storage
 */

import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'pin-vault';
const DB_VERSION = 2;

export interface LocalProduct {
    id: string;
    name: string;
    price: string | number;
    imageUrl: string;
    sellerPin: string; // Quien es el dueño de este producto
    category?: string;
    createdAt: number;
}

export interface LocalMessage {
    id: string;
    channelId: string;
    bucketId: number;
    senderPin: string;
    content: string; // decrypted locally
    encryptedContent: string;
    mediaType: 'text' | 'image' | 'audio' | 'video' | 'product' | 'catalog_sync' | null;
    mediaUrl: string | null;
    expiresAt: number; // timestamp
    createdAt: number; // timestamp
    status: 'pending' | 'sent' | 'delivered' | 'failed';
    syncedAt: number | null;
}

export interface LocalChannel {
    id: string;
    participantA: string;
    participantB: string;
    lastMessage: string | null;
    lastMessageTime: number | null;
    unreadCount: number;
    createdAt: number;
    expirationHours?: number; // Configuración independiente por chat
}

export interface LocalKeyStore {
    pin: string;
    identityKeyPub: string;
    identityKeyPriv: string;
    signedPreKeyPub: string;
    signedPreKeyPriv: string;
    signingKeyPub: string;
    signingKeyPriv: string;
    oneTimePreKeys: string; // JSON stringified
}

// ========== Write-Ahead Log (Memory Buffer) ==========

class WriteAheadLog {
    private buffer: LocalMessage[] = [];
    private flushInterval: ReturnType<typeof setInterval> | null = null;
    private db: IDBPDatabase | null = null;

    constructor() {
        this.startAutoFlush();
    }

    setDb(db: IDBPDatabase) {
        this.db = db;
    }

    append(message: LocalMessage) {
        this.buffer.push(message);
        // Auto-flush if buffer gets too large
        if (this.buffer.length >= 20) {
            this.flush();
        }
    }

    private startAutoFlush() {
        this.flushInterval = setInterval(() => {
            if (this.buffer.length > 0) {
                this.flush();
            }
        }, 3000); // Flush every 3 seconds
    }

    async flush() {
        if (!this.db || this.buffer.length === 0) return;

        const messages = [...this.buffer];
        this.buffer = [];

        const tx = this.db.transaction('messages', 'readwrite');
        const store = tx.objectStore('messages');

        for (const msg of messages) {
            // No guardar el contenido descifrado por seguridad (Zero-Knowledge at Rest)
            const secureMsg = { ...msg, content: '[CIFRADO_LOCAL]' };
            await store.put(secureMsg);
        }

        await tx.done;
    }

    destroy() {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
        }
        this.flush();
    }
}

// ========== IndexedDB Manager ==========

class PinDatabase {
    private db: IDBPDatabase | null = null;
    private wal = new WriteAheadLog();

    async init(): Promise<void> {
        if (this.db) return;

        this.db = await openDB(DB_NAME, DB_VERSION, {
            upgrade(db) {
                // Messages store — indexed by channel and bucket
                if (!db.objectStoreNames.contains('messages')) {
                    const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
                    msgStore.createIndex('by-channel', 'channelId');
                    msgStore.createIndex('by-channel-bucket', ['channelId', 'bucketId']);
                    msgStore.createIndex('by-status', 'status');
                    msgStore.createIndex('by-expires', 'expiresAt');
                }

                // Channels store
                if (!db.objectStoreNames.contains('channels')) {
                    db.createObjectStore('channels', { keyPath: 'id' });
                }

                // Key store (encrypted keys)
                if (!db.objectStoreNames.contains('keys')) {
                    db.createObjectStore('keys', { keyPath: 'pin' });
                }

                // Ratchet states (per channel)
                if (!db.objectStoreNames.contains('ratchets')) {
                    db.createObjectStore('ratchets', { keyPath: 'channelId' });
                }

                // Sync metadata
                if (!db.objectStoreNames.contains('sync')) {
                    db.createObjectStore('sync', { keyPath: 'key' });
                }

                // Products Store (Local Catalog)
                if (!db.objectStoreNames.contains('products')) {
                    db.createObjectStore('products', { keyPath: 'id' });
                }
            },
        });

        this.wal.setDb(this.db);
    }

    // ---- Messages ----

    async addMessage(message: LocalMessage): Promise<void> {
        this.wal.append(message);
    }

    async addMessageDirect(message: LocalMessage): Promise<void> {
        await this.init();
        const tx = this.db!.transaction('messages', 'readwrite');
        const secureMsg = { ...message, content: '[CIFRADO_LOCAL]' };
        await tx.objectStore('messages').put(secureMsg);
        await tx.done;
    }

    async getMessagesByChannel(channelId: string, limit = 50): Promise<LocalMessage[]> {
        await this.init();
        // Flush WAL first to get latest
        await this.wal.flush();

        const tx = this.db!.transaction('messages', 'readonly');
        const index = tx.objectStore('messages').index('by-channel');
        const messages: LocalMessage[] = [];

        let cursor = await index.openCursor(IDBKeyRange.only(channelId), 'prev');
        let count = 0;

        while (cursor && count < limit) {
            const msg = cursor.value;
            // Restaurar el contenido para mostrarlo en el UI
            // En un futuro aquí iría el descifrado real con Signal Protocol
            if (msg.content === '[CIFRADO_LOCAL]') {
                msg.content = msg.encryptedContent;
            }
            messages.push(msg);
            count++;
            cursor = await cursor.continue();
        }

        return messages.reverse();
    }

    async getMessagesByBucket(channelId: string, bucketId: number): Promise<LocalMessage[]> {
        await this.init();
        await this.wal.flush();

        const tx = this.db!.transaction('messages', 'readonly');
        const index = tx.objectStore('messages').index('by-channel-bucket');
        return index.getAll(IDBKeyRange.only([channelId, bucketId]));
    }

    async getPendingMessages(): Promise<LocalMessage[]> {
        await this.init();
        await this.wal.flush();

        const tx = this.db!.transaction('messages', 'readonly');
        const index = tx.objectStore('messages').index('by-status');
        return index.getAll(IDBKeyRange.only('pending'));
    }

    async updateMessageStatus(id: string, status: LocalMessage['status']): Promise<void> {
        await this.init();
        await this.wal.flush();

        const tx = this.db!.transaction('messages', 'readwrite');
        const store = tx.objectStore('messages');
        const msg = await store.get(id);
        if (msg) {
            msg.status = status;
            msg.syncedAt = Date.now();
            await store.put(msg);
        }
        await tx.done;
    }

    async deleteExpiredMessages(): Promise<number> {
        await this.init();
        await this.wal.flush();

        const tx = this.db!.transaction('messages', 'readwrite');
        const store = tx.objectStore('messages');
        const index = store.index('by-expires');
        const now = Date.now();
        let deleted = 0;

        let cursor = await index.openCursor(IDBKeyRange.upperBound(now));
        while (cursor) {
            await cursor.delete();
            deleted++;
            cursor = await cursor.continue();
        }

        await tx.done;
        return deleted;
    }

    async deleteMessage(id: string): Promise<void> {
        await this.init();
        const tx = this.db!.transaction('messages', 'readwrite');
        await tx.objectStore('messages').delete(id);
        await tx.done;
    }

    // ---- Channels ----

    async saveChannel(channel: LocalChannel): Promise<void> {
        await this.init();
        const tx = this.db!.transaction('channels', 'readwrite');
        await tx.objectStore('channels').put(channel);
        await tx.done;
    }

    async getChannels(): Promise<LocalChannel[]> {
        await this.init();
        const tx = this.db!.transaction('channels', 'readonly');
        return tx.objectStore('channels').getAll();
    }

    async getChannel(id: string): Promise<LocalChannel | undefined> {
        await this.init();
        return this.db!.get('channels', id);
    }

    async updateChannelLastMessage(channelId: string, message: string, time: number): Promise<void> {
        await this.init();
        const tx = this.db!.transaction('channels', 'readwrite');
        const store = tx.objectStore('channels');
        const channel = await store.get(channelId);
        if (channel) {
            channel.lastMessage = message;
            channel.lastMessageTime = time;
            await store.put(channel);
        }
        await tx.done;
    }

    // ---- Keys ----

    async saveKeys(keys: LocalKeyStore): Promise<void> {
        await this.init();
        const tx = this.db!.transaction('keys', 'readwrite');
        await tx.objectStore('keys').put(keys);
        await tx.done;
    }

    async getKeys(pin: string): Promise<LocalKeyStore | undefined> {
        await this.init();
        return this.db!.get('keys', pin);
    }

    async getAllKeys(): Promise<LocalKeyStore[]> {
        await this.init();
        return this.db!.getAll('keys');
    }

    // ---- Ratchet States ----

    async saveRatchetState(channelId: string, state: string): Promise<void> {
        await this.init();
        const tx = this.db!.transaction('ratchets', 'readwrite');
        await tx.objectStore('ratchets').put({ channelId, state });
        await tx.done;
    }

    async getRatchetState(channelId: string): Promise<string | undefined> {
        await this.init();
        const record = await this.db!.get('ratchets', channelId);
        return record?.state;
    }

    // ---- Sync ----

    async getLastSyncTime(channelId: string): Promise<number> {
        await this.init();
        const record = await this.db!.get('sync', `last-sync-${channelId}`);
        return record?.value || 0;
    }

    async setLastSyncTime(channelId: string, time: number): Promise<void> {
        await this.init();
        const tx = this.db!.transaction('sync', 'readwrite');
        await tx.objectStore('sync').put({ key: `last-sync-${channelId}`, value: time });
        await tx.done;
    }

    // ---- Products (Catalog) ----

    async saveProduct(product: LocalProduct): Promise<void> {
        await this.init();
        const tx = this.db!.transaction('products', 'readwrite');
        await tx.objectStore('products').put(product);
        await tx.done;
    }

    async getProducts(): Promise<LocalProduct[]> {
        await this.init();
        const tx = this.db!.transaction('products', 'readonly');
        return tx.objectStore('products').getAll();
    }

    async deleteProduct(id: string): Promise<void> {
        await this.init();
        const tx = this.db!.transaction('products', 'readwrite');
        await tx.objectStore('products').delete(id);
        await tx.done;
    }

    // ---- Utility ----

    async clearAll(): Promise<void> {
        await this.init();
        const storeNames = ['messages', 'channels', 'keys', 'ratchets', 'sync'];
        const tx = this.db!.transaction(storeNames, 'readwrite');
        for (const name of storeNames) {
            await tx.objectStore(name).clear();
        }
        await tx.done;
    }

    /**
     * Clear all messages but keep channels, keys, identity
     */
    async clearAllMessages(): Promise<void> {
        await this.init();
        const tx = this.db!.transaction('messages', 'readwrite');
        await tx.objectStore('messages').clear();
        await tx.done;
    }

    destroy() {
        this.wal.destroy();
        this.db?.close();
        this.db = null;
    }
}

// Singleton instance
export const pinDb = new PinDatabase();

// ========== Bucket Utility ==========

/**
 * Calculate bucket ID from timestamp (10-day buckets, Discord-style)
 */
export function calculateBucketId(timestamp: number = Date.now()): number {
    const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;
    return Math.floor(timestamp / TEN_DAYS_MS);
}
