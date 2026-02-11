/**
 * ChatsScreen — Lista de Chats
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { usePinStore } from '@/store/pinStore';
import { pinDb, type LocalChannel, type LocalProduct } from '@/lib/db';
import { getDemoName } from '@/lib/demo';
import ProductStories from './ProductStories';
import { seedDemoData } from '@/lib/seed';

export default function ChatsScreen() {
    const {
        identity,
        channels,
        setChannels,
        setActiveChannelId,
        setCurrentScreen,
        connectionStatus,
        setMessages,
    } = usePinStore();

    const [searchQuery, setSearchQuery] = useState('');
    const [catalogProducts, setCatalogProducts] = useState<LocalProduct[]>([]);
    const [isViewingStories, setIsViewingStories] = useState(false);

    // New Chat State
    const [showNewChatModal, setShowNewChatModal] = useState(false);
    const [newChatPin, setNewChatPin] = useState('');

    const handleCreateChannel = async () => {
        if (!identity?.pin) return;
        const targetPin = newChatPin.trim().toUpperCase();

        if (targetPin.length < 3) {
            alert('INVALID_TARGET_PIN');
            return;
        }
        if (targetPin === identity.pin) {
            alert('ERR_SELF_TARGET');
            return;
        }

        const channelId = [identity.pin, targetPin].sort().join('-');

        // Upsert Channel
        await pinDb.saveChannel({
            id: channelId,
            participantA: identity.pin,
            participantB: targetPin,
            lastMessage: null,
            lastMessageTime: Date.now(),
            unreadCount: 0,
            createdAt: Date.now()
        });

        // Load & Open
        await loadChannels();
        const newCh = await pinDb.getChannel(channelId);
        if (newCh) openChat(newCh);

        setShowNewChatModal(false);
        setNewChatPin('');
    };

    useEffect(() => {
        if (identity?.pin) {
            // Seed demo data (bots, products) if empty
            seedDemoData(identity.pin).then(() => {
                loadChannels();
                loadCatalog();
            });
        }
    }, [identity]);

    const loadCatalog = async () => {
        const products = await pinDb.getProducts();
        // Solo mostrar productos con imagen
        setCatalogProducts(products.filter(p => p.imageUrl));
    };

    const loadChannels = async () => {
        await pinDb.init();
        const localChannels = await pinDb.getChannels();
        localChannels.sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
        setChannels(localChannels);
    };

    const openChat = useCallback(async (channel: LocalChannel) => {
        setActiveChannelId(channel.id);
        const msgs = await pinDb.getMessagesByChannel(channel.id);
        setMessages(msgs);
        setCurrentScreen('conversation');
    }, [setActiveChannelId, setMessages, setCurrentScreen]);

    const getOtherPin = (channel: LocalChannel): string => {
        if (!identity?.pin) return '????????';
        return channel.participantA === identity.pin
            ? channel.participantB
            : channel.participantA;
    };

    const formatTime = (timestamp: number | null): string => {
        if (!timestamp) return '--:--_UTC';
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) + '_UTC';
    };

    const filteredChannels = channels.filter(ch => {
        if (!searchQuery) return true;
        const otherPin = getOtherPin(ch);
        const name = getDemoName(otherPin);
        return otherPin.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (name && name.toLowerCase().includes(searchQuery.toLowerCase()));
    });

    const handleLogout = () => {
        setCurrentScreen('vault');
    };

    const handleSelectFromStory = (product: LocalProduct) => {
        setIsViewingStories(false);
        // Si hay una conversación abierta, podríamos enviar el producto allí.
        // Por ahora, simplemente cerramos y notificamos.
        alert(`PROTOCOL_REQUEST: Solicitando transmisión de asset: ${product.name.toUpperCase()}`);
    };

    return (
        <div className="chats-screen">
            {/* Header Area */}
            <header className="chats-header">
                {/* ... header content ... */}
                <div className="flex items-center justify-between mb-2">
                    <div className="chats-header-left">
                        <button
                            className="header-icon-btn"
                            onClick={() => setCurrentScreen('settings')}
                            title="Menu"
                            style={{ border: 'none', marginLeft: -8, marginRight: 8 }}
                        >
                            <span className="material-symbols-outlined" style={{ fontSize: 24 }}>menu</span>
                        </button>
                        <img
                            src="https://github.com/leehot69-web/pin/blob/master/Gemini_Generated_Image_fxd2lufxd2lufxd2-removebg-preview.png?raw=true"
                            alt="Logo"
                            style={{ width: 40, height: 'auto', marginLeft: 8 }}
                        />
                    </div>
                    <div className="chats-header-badge">NODO_ENCRIPTADO_v4.2</div>
                </div>

                {/* Search Bar - Technical Style */}
                <div className="relative" style={{ marginTop: 8 }}>
                    <span className="material-symbols-outlined" style={{
                        position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                        fontSize: 18, color: 'rgba(255,255,255,0.4)'
                    }}>search</span>
                    <input
                        className="w-full bg-black border border-white/20 py-3 pl-10 pr-4 text-[10px] font-mono placeholder:text-white/30 focus:ring-0 focus:border-white transition-all uppercase"
                        type="text"
                        placeholder="BUSCAR_PIN_ID..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{ border: '0.5px solid rgba(255,255,255,0.2)', backgroundColor: 'transparent', outline: 'none' }}
                    />
                </div>
            </header>

            <div className="chats-list-main">
                {/* Session Indicator */}
                <div className="flex justify-center my-4">
                    <div style={{
                        border: '0.5px solid rgba(255,255,255,0.4)',
                        padding: '4px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8
                    }}>
                        <span style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: connectionStatus === 'active' ? '#fff' : 'rgba(255,255,255,0.2)'
                        }}></span>
                        <span className="vault-subtitle" style={{ fontSize: 8, color: '#fff' }}>SESION_E2EE_ACTIVA</span>
                    </div>
                </div>

                {/* Active User Metadata */}
                <div style={{ padding: '0 24px 12px', opacity: 0.4 }}>
                    <span className="vault-subtitle" style={{ fontSize: 7 }}>CONNECTED_AS: {identity?.pin || 'NULL'}</span>
                </div>

                {/* MY STORE STATUS (WhatsApp Style) */}
                <div className="status-section" style={{ padding: '0 24px 16px' }}>
                    <div
                        className="flex items-center gap-3 p-3 rounded-2xl active:bg-white/5 transition-colors"
                        onClick={() => catalogProducts.length > 0 ? setIsViewingStories(true) : alert('NO_HAY_PRODUCTOS_CONFIGURADOS')}
                        style={{ cursor: 'pointer', border: '0.5px solid rgba(255,255,255,0.05)' }}
                    >
                        <div className="relative">
                            <div style={{
                                width: 56, height: 56, borderRadius: '50%',
                                border: catalogProducts.length > 0 ? '2px solid #00f2ff' : '2px dashed rgba(255,255,255,0.2)',
                                padding: 2,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                overflow: 'hidden'
                            }}>
                                {catalogProducts.length > 0 ? (
                                    <img
                                        src={catalogProducts[0].imageUrl}
                                        alt=""
                                        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                                    />
                                ) : (
                                    <span className="material-symbols-outlined" style={{ fontSize: 24, opacity: 0.4 }}>storefront</span>
                                )}
                            </div>
                            {catalogProducts.length > 0 && (
                                <div style={{
                                    position: 'absolute', bottom: 0, right: 0,
                                    width: 18, height: 18, background: '#00f2ff',
                                    borderRadius: '50%', border: '2px solid #000',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                                }}>
                                    <span className="material-symbols-outlined" style={{ fontSize: 10, color: '#000', fontWeight: 'bold' }}>add</span>
                                </div>
                            )}
                        </div>
                        <div className="flex-1">
                            <h3 className="vault-subtitle" style={{ fontSize: 14, color: '#fff', fontWeight: 700 }}>MI CATALOGO</h3>
                            <p className="vault-subtitle" style={{ fontSize: 10, opacity: 0.5, marginTop: 2 }}>
                                {catalogProducts.length > 0
                                    ? `${catalogProducts.length} assets en transmisión...`
                                    : 'Toca para configurar tu tienda'}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Chat List Body */}
                <main style={{ borderTop: '0.5px solid white' }}>
                    {filteredChannels.length === 0 ? (
                        <div className="chats-empty">
                            <span className="material-symbols-outlined" style={{ fontSize: 48, opacity: 0.2 }}>lock</span>
                            <p className="vault-subtitle" style={{ opacity: 0.3, marginTop: 12 }}>NO_HAY_CANALES_ACTIVOS</p>
                        </div>
                    ) : (
                        filteredChannels.map((channel) => {
                            const otherPin = getOtherPin(channel);
                            const demoName = getDemoName(otherPin);
                            const lastMsg = channel.lastMessage || '_encrypted_payload_v4.2...[DECRYPTED]';

                            return (
                                <div
                                    key={channel.id}
                                    className="chat-item"
                                    onClick={() => openChat(channel)}
                                    style={{ position: 'relative' }}
                                >
                                    <div className="chat-avatar" style={{ border: '0.5px solid rgba(255,255,255,0.4)', width: 44, height: 44 }}>
                                        <span style={{ fontSize: 10, opacity: 0.6 }}>{otherPin.slice(0, 4)}</span>
                                        {channel.unreadCount > 0 && (
                                            <div style={{
                                                position: 'absolute', top: -4, right: -4,
                                                width: 10, height: 10, background: '#fff',
                                                border: '1px solid #000', borderRadius: '50%'
                                            }}></div>
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-baseline mb-1">
                                            <h3 className="chat-pin-id" style={{ fontSize: 13 }}>
                                                {demoName ? `${demoName.toUpperCase()} ` : ''}PIN-{otherPin}
                                            </h3>
                                            <span className="chat-time">{formatTime(channel.lastMessageTime)}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="material-symbols-outlined" style={{ fontSize: 14, opacity: 0.3 }}>lock</span>
                                            <p className="chat-preview" style={{ fontSize: 10, opacity: 0.5 }}>{lastMsg}</p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </main>

                {/* New Chat Button */}
                <button
                    className="fixed bottom-28 right-6 w-14 h-14 bg-white text-black flex items-center justify-center active:scale-90 transition-transform shadow-xl z-40"
                    onClick={() => setShowNewChatModal(true)}
                >
                    <span className="material-symbols-outlined" style={{ fontSize: 32 }}>add</span>
                </button>
            </div>

            {/* NEW CHAT MODAL */}
            {showNewChatModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-6 animate-in fade-in duration-200">
                    <div className="w-full max-w-sm bg-[#0a0a0a] border border-white/20 p-6 shadow-2xl relative">
                        <button
                            onClick={() => setShowNewChatModal(false)}
                            className="absolute top-2 right-2 text-white/50 hover:text-white"
                        >
                            <span className="material-symbols-outlined">close</span>
                        </button>

                        <h3 className="vault-title" style={{ fontSize: 20, marginBottom: 4 }}>ESTABLISH_LINK</h3>
                        <p className="vault-subtitle mb-6">ENTER_TARGET_PIN_IDENTITY</p>

                        <div className="flex flex-col gap-4">
                            <input
                                type="text"
                                placeholder="TARGET PIN (e.g. A1B2)"
                                value={newChatPin}
                                onChange={(e) => setNewChatPin(e.target.value.toUpperCase())}
                                className="w-full bg-black border border-white/30 text-white p-3 font-mono text-center tracking-widest outline-none focus:border-white transition-colors"
                                autoFocus
                            />

                            <button
                                onClick={handleCreateChannel}
                                disabled={!newChatPin}
                                className="w-full bg-white text-black font-bold py-3 mt-2 hover:bg-gray-200 disabled:opacity-50"
                            >
                                INITIATE_PROTOCOL
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Story Viewer Layer */}
            {isViewingStories && catalogProducts.length > 0 && (
                <ProductStories
                    products={catalogProducts}
                    onClose={() => setIsViewingStories(false)}
                    onSelectProduct={handleSelectFromStory}
                />
            )}
        </div>
    );
}
