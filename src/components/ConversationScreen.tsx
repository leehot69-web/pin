/**
 * ConversationScreen — Chat con soporte multimedia
 * 
 * Soporta:
 * - Mensajes de texto
 * - Imágenes (galería + cámara)
 * - Notas de voz
 * - Comunicación cross-tab en tiempo real
 * - Indicador de "escribiendo..."
 */

'use client';

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { usePinStore } from '@/store/pinStore';
import { pinDb, LocalMessage, LocalChannel, calculateBucketId } from '@/lib/db';
import { getDemoName } from '@/lib/demo';
import { crossTab, type CrossTabMessage } from '@/lib/crossTab';
import { syncService } from '@/lib/sync'; // Integración Nube
import { simulateBotResponse } from '@/lib/bots';
import { formatDuration } from '@/lib/media';
import ChatInput from './ChatInput';
import ProductCard from './ProductCard';

export default function ConversationScreen() {
    const {
        identity,
        activeChannelId,
        messages,
        addMessage,
        updateMessageStatus,
        setCurrentScreen,
        setActiveChannelId,
        channels,
        verificationStatus,
        setVerificationStatus,
    } = usePinStore();

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [isOtherTyping, setIsOtherTyping] = useState(false);
    const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [lightboxImage, setLightboxImage] = useState<string | null>(null);
    const [showChatSettings, setShowChatSettings] = useState(false);

    // Scroll al final
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }, [messages]);

    // Simular verificación E2EE
    useEffect(() => {
        if (verificationStatus === 'idle') {
            setVerificationStatus('verifying');
            setTimeout(() => setVerificationStatus('verified'), 2000);
        }
    }, [verificationStatus, setVerificationStatus]);

    // ========== ESCUCHAR MENSAJES DE OTRA PESTAÑA ==========
    useEffect(() => {
        const unsubscribe = crossTab.onMessage(async (msg: CrossTabMessage) => {
            if (msg.channelId !== activeChannelId) return;

            if (msg.type === 'message' && (msg.payload.content || msg.payload.mediaUrl || msg.payload.encryptedContent)) {
                const now = msg.payload.createdAt || Date.now();
                const mediaType = (msg.payload.mediaType as LocalMessage['mediaType']) || 'text';

                // --- GESTIÓN DE SINCRONIZACIÓN DE CATÁLOGO ---
                if (mediaType === 'catalog_sync' && msg.payload.encryptedContent) {
                    try {
                        const remoteProducts = JSON.parse(msg.payload.encryptedContent);
                        for (const rp of remoteProducts) {
                            await pinDb.saveProduct({
                                ...rp,
                                sellerPin: msg.senderPin, // Asegurar que el dueño es el remitente
                                createdAt: Date.now()
                            });
                        }
                        console.log(`CATALOG_SYNC: Cargados ${remoteProducts.length} assets de PIN-${msg.senderPin.slice(0, 8)}`);
                        return; // No procesar como mensaje visible
                    } catch (e) {
                        console.error("Error syncing remote catalog", e);
                    }
                }

                const incomingMsg: LocalMessage = {
                    id: msg.payload.id || `cross-${Date.now()}`,
                    channelId: msg.channelId,
                    bucketId: calculateBucketId(now),
                    senderPin: msg.senderPin,
                    content: msg.payload.content || '',
                    encryptedContent: msg.payload.encryptedContent || msg.payload.content || '',
                    mediaType: mediaType,
                    mediaUrl: msg.payload.mediaUrl || null,
                    expiresAt: msg.payload.expiresAt || now + (8 * 60 * 60 * 1000),
                    createdAt: now,
                    status: 'delivered',
                    syncedAt: now,
                };

                addMessage(incomingMsg);
                pinDb.addMessage(incomingMsg); // Usar addMessage (Zero-Knowledge)

                const preview = incomingMsg.mediaType === 'image' ? '📷 Foto' :
                    incomingMsg.mediaType === 'audio' ? '🎤 Nota de voz' :
                        incomingMsg.mediaType === 'product' ? '📦 Producto' :
                            incomingMsg.content;
                pinDb.updateChannelLastMessage(msg.channelId, preview, now);

                crossTab.sendDelivered(msg.channelId, incomingMsg.id);
                setIsOtherTyping(false);
            }

            if (msg.type === 'typing') {
                setIsOtherTyping(!!msg.payload.isTyping);
                if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                if (msg.payload.isTyping) {
                    typingTimeoutRef.current = setTimeout(() => setIsOtherTyping(false), 3000);
                }
            }

            if (msg.type === 'delivered' && msg.payload.id) {
                updateMessageStatus(msg.payload.id, 'delivered');
            }
        });

        return () => {
            unsubscribe();
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        };
    }, [activeChannelId, addMessage, updateMessageStatus]);

    // Obtener el PIN del otro
    const getOtherPin = (): string => {
        if (!identity?.pin || !activeChannelId) return '????????';
        const channel = channels.find(ch => ch.id === activeChannelId);
        if (!channel) return '????????';
        return channel.participantA === identity.pin
            ? channel.participantB
            : channel.participantA;
    };

    // --- SINCRONIZACION DE CATALOGO ---
    useEffect(() => {
        if (activeChannelId && identity?.pin) {
            syncCatalogWithPartner();
        }
    }, [activeChannelId, identity?.pin]);

    const syncCatalogWithPartner = async () => {
        try {
            const allProducts = await pinDb.getProducts();
            // Solo mis productos
            const myProducts = allProducts.filter(p => p.sellerPin === identity?.pin);

            if (myProducts.length > 0) {
                const catalogData = JSON.stringify(myProducts);
                // Enviamos nuestro catálogo de forma silenciosa
                await createAndSendMessage('', 'catalog_sync', null, catalogData);
                console.log("MY_CATALOG_SYNC_TRANSMITTED");
            }
        } catch (e) {
            console.error("Failed to sync catalog", e);
        }
    };

    const handleCopyPin = () => {
        if (identity?.pin) {
            navigator.clipboard.writeText(identity.pin);
            alert('PIN copiado al portapapeles');
        }
    };

    const handleBack = () => {
        setCurrentScreen('chats');
        setActiveChannelId(null);
        setVerificationStatus('idle');
    };

    // ========== CREAR Y ENVIAR MENSAJE ==========

    const createAndSendMessage = useCallback(async (
        content: string,
        mediaType: LocalMessage['mediaType'],
        mediaUrl: string | null = null,
        productMeta: string | null = null
    ) => {
        if (!activeChannelId || !identity?.pin) return;

        const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const now = Date.now();
        const bucketId = calculateBucketId(now);

        // Buscar el canal para ver si tiene configuración propia
        const channel = channels.find(ch => ch.id === activeChannelId);

        // Prioridad: 1. Canal, 2. Global (localStorage), 3. Default 8h
        let expireHours = parseInt(localStorage.getItem('pin-msg-expire') || '8');
        if (channel?.expirationHours !== undefined) {
            expireHours = channel.expirationHours;
        }

        const expiresAt = expireHours === 0
            ? now + (365 * 24 * 60 * 60 * 1000) // 1 año si es 'nunca'
            : now + (expireHours * 60 * 60 * 1000);

        const localMsg: LocalMessage = {
            id: msgId,
            channelId: activeChannelId,
            bucketId,
            senderPin: identity.pin,
            content,
            encryptedContent: (mediaType === 'product' || mediaType === 'catalog_sync') && productMeta ? productMeta : content,
            mediaType,
            mediaUrl,
            expiresAt,
            createdAt: now,
            status: 'pending',
            syncedAt: null,
        };

        // Guardar local
        await pinDb.addMessage(localMsg);
        addMessage(localMsg);

        // Actualizar último mensaje del canal
        const preview = mediaType === 'image' ? '📷 Foto' :
            mediaType === 'audio' ? '🎤 Nota de voz' :
                mediaType === 'product' ? '📦 Producto' :
                    content;
        await pinDb.updateChannelLastMessage(activeChannelId, preview, now);

        await pinDb.updateChannelLastMessage(activeChannelId, preview, now);

        setTimeout(() => updateMessageStatus(msgId, 'sent'), 300);

        // --- CLOUD SYNC ---
        // Enviar a Supabase para que el amigo lo vea "desde afuera"
        syncService.sendMessage(localMsg, identity.pin).catch(err => {
            console.warn('[CLOUD] Fallo envio nube, se reintentará luego', err);
        });

        // Enviar a la otra pestaña (Local Sync)
        crossTab.broadcast({
            type: 'message',
            channelId: activeChannelId,
            senderPin: identity.pin,
            payload: {
                id: msgId,
                content: localMsg.content,
                encryptedContent: localMsg.encryptedContent,
                mediaType: mediaType || undefined,
                mediaUrl: mediaUrl || undefined,
                expiresAt,
            },
        });

        // --- BOT SIMULATION ---
        const otherPin = activeChannelId.replace(identity.pin, '').replace('-', '');
        if (otherPin.startsWith('BOT-')) {
            simulateBotResponse(otherPin, content, (isTyping) => { }, async (res) => {
                const botMsg: LocalMessage = {
                    id: `bot-${Date.now()}`,
                    channelId: activeChannelId,
                    bucketId,
                    senderPin: otherPin,
                    content: res,
                    encryptedContent: res, // No encryption for demo
                    mediaType: 'text',
                    mediaUrl: null,
                    expiresAt: now + 86400000,
                    createdAt: Date.now(),
                    status: 'delivered',
                    syncedAt: Date.now()
                };
                await pinDb.addMessage(botMsg);
                addMessage(botMsg);
                await pinDb.updateChannelLastMessage(activeChannelId, res, Date.now());
            });
        }
    }, [activeChannelId, identity, addMessage, updateMessageStatus, channels]);

    // ---- Handlers específicos ----

    const handleSendText = useCallback(async (text: string) => {
        await createAndSendMessage(text, 'text');
    }, [createAndSendMessage]);

    const handleSendImage = useCallback(async (dataUrl: string) => {
        await createAndSendMessage('📷 Foto', 'image', dataUrl);
    }, [createAndSendMessage]);

    const handleSendAudio = useCallback(async (dataUrl: string, duration: number) => {
        await createAndSendMessage(`🎤 ${formatDuration(duration)}`, 'audio', dataUrl);
    }, [createAndSendMessage]);

    const handleSendProduct = useCallback(async (jsonMeta: string) => {
        await createAndSendMessage('[PRODUCT_META]', 'product', null, jsonMeta);
    }, [createAndSendMessage]);

    const handleTyping = useCallback(() => {
        if (activeChannelId) {
            crossTab.sendTyping(activeChannelId, true);
        }
    }, [activeChannelId]);

    // --- CONEXION CHAT A SERVICIO DE SYNC ---
    useEffect(() => {
        if (!activeChannelId || !identity?.pin) return;

        const loadMessages = async () => {
            const msgs = await pinDb.getMessagesByChannel(activeChannelId);
            usePinStore.getState().setMessages(msgs);
        };
        loadMessages();

        // --- REALTIME SUBSCRIPTION ---
        // Escuchar mensajes de internet para este canal
        const sub = syncService.subscribeToChannel(activeChannelId, (incomingMsg) => {
            // Solo añadir si no es mío (aunque syncService ya filtra un poco)
            if (incomingMsg.senderPin !== identity.pin) {
                addMessage(incomingMsg);
            }
        });

        // Traer mensajes perdidos mientras estaba offline
        syncService.pullMissedMessages(activeChannelId).catch(console.error);

        return () => {
            sub.unsubscribe();
        };

    }, [activeChannelId, identity, addMessage]);

    const handleSetChannelExpiration = async (hours: number | undefined) => {
        if (!activeChannelId) return;
        const channel = channels.find(ch => ch.id === activeChannelId);
        if (!channel) return;

        const updated = { ...channel, expirationHours: hours };
        await pinDb.saveChannel(updated);
        // Actualizar el store para que el UI responda
        usePinStore.getState().updateChannel(activeChannelId, updated);
        setShowChatSettings(false);
    };

    // ---- Formatear hora ----
    const formatMessageTime = (timestamp: number): string => {
        return new Date(timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
    };

    const getStatusIcon = (status: LocalMessage['status']): string => {
        switch (status) {
            case 'pending': return '⏳';
            case 'sent': return '✓';
            case 'delivered': return '✓✓';
            case 'failed': return '⚠️';
            default: return '';
        }
    };

    const shouldShowDateSep = (msg: LocalMessage, prevMsg: LocalMessage | null): boolean => {
        if (!prevMsg) return true;
        return new Date(msg.createdAt).toDateString() !== new Date(prevMsg.createdAt).toDateString();
    };

    const otherPin = getOtherPin();
    const demoName = getDemoName(otherPin);

    return (
        <div className="conversation-screen screen-enter">
            {/* Encabezado Técnico con Blur */}
            <header className="conv-header">
                <button className="conv-back-btn" onClick={handleBack}>
                    <span className="material-symbols-outlined" style={{ fontSize: 24 }}>chevron_left</span>
                </button>
                <div className="conv-header-info">
                    <h1 className="conv-header-pin">PIN:{otherPin}</h1>
                    <div className="vault-subtitle" style={{ fontSize: 7, opacity: 0.4 }}>
                        {demoName ? `IDENTIDAD: ${demoName}` : 'CANAL_P2P_CIFRADO'}
                    </div>
                </div>

                <div style={{ position: 'relative' }}>
                    <button
                        className="header-icon-btn"
                        onClick={() => setShowChatSettings(!showChatSettings)}
                        style={{ border: 'none', background: 'transparent', opacity: showChatSettings ? 1 : 0.6 }}
                    >
                        <span className="material-symbols-outlined" style={{ fontSize: 22 }}>history_toggle_off</span>
                    </button>

                    {showChatSettings && (
                        <div className="absolute top-full right-0 mt-2 bg-[#0a0a0a] border border-white/20 p-2 z-[1000] w-[220px] shadow-[0_10px_40px_rgba(0,0,0,0.8)]">
                            <div className="px-3 py-2 border-b border-white/10 mb-2">
                                <span className="vault-subtitle" style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)', letterSpacing: 1 }}>BORRADO_AUTOMATICO</span>
                            </div>

                            {[
                                { lab: 'GLOBAL (DEFAULT)', val: undefined },
                                { lab: 'NUNCA', val: 0 },
                                { lab: '1 HORA', val: 1 },
                                { lab: '8 HORAS', val: 8 },
                                { lab: '24 HORAS', val: 24 },
                                { lab: '7 DIAS', val: 168 }
                            ].map((opt, i) => {
                                const activeChannel = channels.find(ch => ch.id === activeChannelId);
                                const isSelected = activeChannel?.expirationHours === opt.val;

                                return (
                                    <button
                                        key={i}
                                        className={`w-full text-left px-3 py-3 hover:bg-white/10 flex items-center justify-between transition-colors`}
                                        onClick={() => handleSetChannelExpiration(opt.val)}
                                        style={{ border: 'none', background: 'transparent' }}
                                    >
                                        <span className="vault-subtitle" style={{ fontSize: 9, color: isSelected ? '#fff' : 'rgba(255,255,255,0.5)' }}>{opt.lab}</span>
                                        {isSelected && <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#fff' }}>check</span>}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </header>

            {/* Área de Scroll de Mensajes */}
            <div className="messages-area">
                {/* Etiquetas de Sesión Técnica */}
                <div className="encryption-status-label">
                    CANAL_E2EE_ESTABLECIDO_v4.2<br />
                    SIGNAL_PROTOCOL_ACTIVO_NODO_0x{activeChannelId?.slice(-4) || 'NULL'}
                </div>

                {messages.length === 0 && (
                    <p className="encryption-status-label" style={{ marginTop: 40, opacity: 0.2 }}>
                        _NO_SE_ENCONTRARON_DATOS_EN_EL_BUFFER_
                    </p>
                )}

                {messages.filter(m => m.mediaType !== 'catalog_sync').map((msg, idx) => {
                    const prevMsg = idx > 0 ? messages[idx - 1] : null;
                    const isSent = msg.senderPin === identity?.pin;
                    const showDate = shouldShowDateSep(msg, prevMsg);

                    return (
                        <React.Fragment key={msg.id}>
                            {showDate && (
                                <div className="encryption-status-label" style={{ opacity: 0.2, margin: '24px 0' }}>
                                    ── SESSION_LOG_{new Date(msg.createdAt).toLocaleDateString('en-US').toUpperCase()} ──
                                </div>
                            )}

                            <div className={`message-group ${isSent ? 'sent' : 'received'}`} style={{ alignSelf: isSent ? 'flex-end' : 'flex-start' }}>
                                <div className="message-bubble">
                                    {/* IMAGEN */}
                                    {msg.mediaType === 'image' && msg.mediaUrl && (
                                        <div className="media-preview-container" onClick={() => setLightboxImage(msg.mediaUrl)}>
                                            <img src={msg.mediaUrl} alt="Payload" className="media-preview-img" style={{ width: '100%', display: 'block' }} />
                                        </div>
                                    )}

                                    {/* AUDIO */}
                                    {msg.mediaType === 'audio' && msg.mediaUrl && (
                                        <div className="media-preview-container" style={{ padding: '8px 4px', background: 'rgba(255,255,255,0.05)' }}>
                                            <audio controls preload="none" src={msg.mediaUrl} style={{ width: '100%', height: 32, filter: 'invert(1)' }} />
                                        </div>
                                    )}

                                    {/* PRODUCT CARD */}
                                    {msg.mediaType === 'product' && (
                                        <div style={{ padding: '4px' }}>
                                            {(() => {
                                                try {
                                                    const data = JSON.parse(msg.encryptedContent);
                                                    return (
                                                        <ProductCard
                                                            name={data.name || 'Unknown'}
                                                            price={data.price || '0'}
                                                            imageUrl={data.imageUrl || ''}
                                                            productId={data.productId || msg.id}
                                                            onSelect={(id) => handleSendText(`[ REQUEST_ITEM ] Protocolo de adquisición iniciado para el producto ID: ${id}`)}
                                                        />
                                                    );
                                                } catch {
                                                    return <p className="message-content">ERROR_PARSING_PRODUCT_META</p>;
                                                }
                                            })()}
                                        </div>
                                    )}

                                    {/* TEXTO / UBICACION */}
                                    {(msg.mediaType === 'text' || !msg.mediaType) && (
                                        <>
                                            {msg.content.startsWith('[LOCATION]:') ? (
                                                <div className="location-card" style={{ width: '100%', minWidth: 200, overflow: 'hidden', borderRadius: 0 }}>
                                                    {(() => {
                                                        try {
                                                            const parts = msg.content.replace('[LOCATION]:', '').trim().split(',');
                                                            const lat = parts[0];
                                                            const lon = parts[1];
                                                            return (
                                                                <>
                                                                    <div style={{ height: 150, width: '100%', background: '#eee' }}>
                                                                        <iframe
                                                                            width="100%"
                                                                            height="100%"
                                                                            frameBorder="0"
                                                                            scrolling="no"
                                                                            marginHeight={0}
                                                                            marginWidth={0}
                                                                            src={`https://www.openstreetmap.org/export/embed.html?bbox=${parseFloat(lon) - 0.01}%2C${parseFloat(lat) - 0.01}%2C${parseFloat(lon) + 0.01}%2C${parseFloat(lat) + 0.01}&layer=mapnik&marker=${lat}%2C${lon}`}
                                                                            style={{ border: 'none', filter: 'grayscale(100%) contrast(1.2)' }}
                                                                        />
                                                                    </div>
                                                                    <div style={{ padding: 12, borderTop: '1px solid #333', background: '#000' }}>
                                                                        <div className="vault-subtitle" style={{ fontSize: 9, color: '#fff', marginBottom: 4 }}>SHARED_COORDINATES</div>
                                                                        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#00f2ff' }}>{lat}, {lon}</div>
                                                                        <a
                                                                            href={`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`}
                                                                            target="_blank"
                                                                            rel="noreferrer"
                                                                            style={{
                                                                                display: 'inline-block',
                                                                                marginTop: 8,
                                                                                background: '#fff',
                                                                                color: '#000',
                                                                                padding: '4px 8px',
                                                                                fontSize: 9,
                                                                                textDecoration: 'none',
                                                                                fontWeight: 700
                                                                            }}
                                                                        >
                                                                            OPEN_MAP
                                                                        </a>
                                                                    </div>
                                                                </>
                                                            );
                                                        } catch (e) {
                                                            return <p className="message-content">{msg.content}</p>;
                                                        }
                                                    })()}
                                                </div>
                                            ) : (
                                                <p className="message-content">{msg.content}</p>
                                            )}
                                        </>
                                    )}
                                </div>

                                <div className="message-meta">
                                    <span style={{ fontSize: 9, opacity: 0.4, fontFamily: 'var(--font-mono)' }}>0x{msg.id.slice(-4)}</span>
                                    <span className="message-time">{formatMessageTime(msg.createdAt)}</span>
                                    {isSent && (
                                        <span className="material-symbols-outlined" style={{ fontSize: 10, color: msg.status === 'delivered' ? '#fff' : 'rgba(255,255,255,0.4)', fontWeight: 'bold' }}>
                                            {msg.status === 'delivered' ? 'done_all' : 'done'}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </React.Fragment>
                    );
                })}

                {/* Typing Indicator */}
                {isOtherTyping && (
                    <div className="message-group received">
                        <div className="message-bubble" style={{ opacity: 0.4, borderStyle: 'dashed' }}>
                            <p className="message-content" style={{ fontSize: 10, letterSpacing: 2 }}>_incoming_stream...</p>
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Lightbox */}
            {lightboxImage && (
                <div className="lightbox-overlay" onClick={() => setLightboxImage(null)}>
                    <img src={lightboxImage} alt="Fullscreen Payload" className="lightbox-image" />
                    <button className="lightbox-close" onClick={() => setLightboxImage(null)}>
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>
            )}

            {/* Input Overlay handled by global styles for .chat-footer */}
            <footer className="chat-footer">
                <ChatInput
                    onSend={handleSendText}
                    onSendImage={handleSendImage}
                    onSendAudio={handleSendAudio}
                    onSendProduct={handleSendProduct}
                    onTyping={handleTyping}
                    disabled={false}
                />
            </footer>
        </div>
    );
}
