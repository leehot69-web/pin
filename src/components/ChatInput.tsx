/**
 * ChatInput — Input completo con multimedia
 * 
 * Funcionalidades:
 * - Texto con auto-resize
 * - Seleccionar imagen de galería
 * - Capturar foto con cámara
 * - Grabar nota de voz (estilo Telegram: grabar → preview → enviar)
 * - Indicador de "escribiendo..."
 * - Optimizado para Safari iOS
 */

'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { usePinStore } from '@/store/pinStore';
import { pinDb, type LocalProduct } from '@/lib/db';
import {
    pickImageFromGallery,
    captureFromCamera,
    compressImage,
    VoiceRecorder,
    formatDuration,
} from '@/lib/media';

interface ChatInputProps {
    onSend: (text: string) => void;
    onSendImage: (dataUrl: string) => void;
    onSendAudio: (dataUrl: string, duration: number) => void;
    onSendProduct: (jsonMeta: string) => void;
    onTyping?: () => void;
    disabled?: boolean;
}

type InputMode = 'text' | 'recording' | 'preview-audio' | 'preview-image';

const ChatInput = React.memo(function ChatInput({
    onSend,
    onSendImage,
    onSendAudio,
    onSendProduct,
    onTyping,
    disabled,
}: ChatInputProps) {
    const [text, setText] = useState('');
    const [mode, setMode] = useState<InputMode>('text');
    const [recordTime, setRecordTime] = useState(0);
    const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
    const [previewAudioDuration, setPreviewAudioDuration] = useState(0);
    const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
    const [isCompressing, setIsCompressing] = useState(false);
    const [showMediaMenu, setShowMediaMenu] = useState(false);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);

    // Catalog state for picker
    const [myProducts, setMyProducts] = useState<LocalProduct[]>([]);
    const [showProductPicker, setShowProductPicker] = useState(false);

    // Cargar productos al abrir el menú
    useEffect(() => {
        if (showMediaMenu) {
            pinDb.getProducts().then(setMyProducts);
        } else {
            setShowProductPicker(false);
        }
    }, [showMediaMenu]);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const recorderRef = useRef<VoiceRecorder | null>(null);
    const typingDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
    const audioPreviewRef = useRef<HTMLAudioElement | null>(null);

    // Safari iOS keyboard fix
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const viewport = window.visualViewport;
        if (!viewport) return;

        const handleResize = () => {
            const bottom = window.innerHeight - viewport.height - viewport.offsetTop;
            document.documentElement.style.setProperty('--keyboard-height', `${Math.max(0, bottom)}px`);
        };

        viewport.addEventListener('resize', handleResize);
        viewport.addEventListener('scroll', handleResize);
        return () => {
            viewport.removeEventListener('resize', handleResize);
            viewport.removeEventListener('scroll', handleResize);
        };
    }, []);

    // Cleanup al desmontar
    useEffect(() => {
        return () => {
            recorderRef.current?.cancel();
        };
    }, []);

    // ========== TEXTO ==========
    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setText(e.target.value);
        if (onTyping) {
            if (typingDebounce.current) clearTimeout(typingDebounce.current);
            onTyping();
            typingDebounce.current = setTimeout(() => { }, 1000);
        }
    };

    const handleSendText = useCallback(() => {
        const trimmed = text.trim();
        if (!trimmed) return;
        onSend(trimmed);
        setText('');
        setShowMediaMenu(false);
    }, [text, onSend]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendText();
        }
    };

    // ========== IMAGEN (Galería) ==========

    const handlePickImage = useCallback(async () => {
        setShowMediaMenu(false);
        const file = await pickImageFromGallery();
        if (!file) return;

        setIsCompressing(true);
        setMode('preview-image');

        try {
            const dataUrl = await compressImage(file);
            setPreviewImageUrl(dataUrl);
        } catch (err) {
            console.error('[PIN] Error al comprimir:', err);
            setMode('text');
        } finally {
            setIsCompressing(false);
        }
    }, []);

    // ========== IMAGEN (Cámara) ==========

    const handleCaptureCamera = useCallback(async () => {
        setShowMediaMenu(false);
        const file = await captureFromCamera();
        if (!file) return;

        setIsCompressing(true);
        setMode('preview-image');

        try {
            const dataUrl = await compressImage(file);
            setPreviewImageUrl(dataUrl);
        } catch (err) {
            console.error('[PIN] Error al capturar:', err);
            setMode('text');
        } finally {
            setIsCompressing(false);
        }
    }, []);

    const handleSendImage = useCallback(() => {
        if (previewImageUrl) {
            onSendImage(previewImageUrl);
            setPreviewImageUrl(null);
            setMode('text');
        }
    }, [previewImageUrl, onSendImage]);

    const handleDiscardImage = useCallback(() => {
        setPreviewImageUrl(null);
        setMode('text');
    }, []);

    // ========== AUDIO ==========

    const handleStartRecording = useCallback(async () => {
        setShowMediaMenu(false);
        const recorder = new VoiceRecorder();
        recorderRef.current = recorder;

        recorder.onTimeUpdate = (seconds) => setRecordTime(seconds);

        const started = await recorder.start();
        if (started) {
            setMode('recording');
            setRecordTime(0);
        } else {
            alert('No se pudo acceder al micrófono. Verifica los permisos.');
        }
    }, []);

    const handleStopRecording = useCallback(async () => {
        if (!recorderRef.current) return;

        try {
            const recording = await recorderRef.current.stop();
            setPreviewAudioUrl(recording.dataUrl);
            setPreviewAudioDuration(recording.duration);
            setMode('preview-audio');
        } catch (err) {
            console.error('[PIN] Error al detener grabación:', err);
            setMode('text');
        }
    }, []);

    const handleCancelRecording = useCallback(() => {
        recorderRef.current?.cancel();
        recorderRef.current = null;
        setMode('text');
        setRecordTime(0);
    }, []);

    const handleSendAudio = useCallback(() => {
        if (previewAudioUrl) {
            onSendAudio(previewAudioUrl, previewAudioDuration);
            setPreviewAudioUrl(null);
            setPreviewAudioDuration(0);
            setMode('text');
        }
    }, [previewAudioUrl, previewAudioDuration, onSendAudio]);

    const handleDiscardAudio = useCallback(() => {
        setPreviewAudioUrl(null);
        setPreviewAudioDuration(0);
        setMode('text');
    }, []);

    const handlePlayPreview = useCallback(() => {
        if (previewAudioUrl && audioPreviewRef.current) {
            audioPreviewRef.current.src = previewAudioUrl;
            audioPreviewRef.current.play();
        }
    }, [previewAudioUrl]);

    // ========== RENDER POR MODO ==========

    // --- MODO: Grabando Audio ---
    if (mode === 'recording') {
        return (
            <div className="input-container" style={{ padding: '8px 12px', background: 'var(--pin-black)', borderTop: '0.5px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                <div className="flex-1 flex items-center gap-3 min-w-0">
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#ff4444', animation: 'pulse 1.5s infinite' }}>mic</span>
                        <span className="vault-subtitle" style={{ fontSize: 10, letterSpacing: 2, color: '#fff' }}>{formatDuration(recordTime)}</span>
                    </div>
                    <span className="vault-subtitle truncate" style={{ fontSize: 9, color: '#aaa' }}>_capturing...</span>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                    <button className="vault-btn-ghost" onClick={handleCancelRecording} style={{ color: 'rgba(255,255,255,0.4)', padding: 4 }}>
                        CANCEL
                    </button>
                    <button className="vault-btn" onClick={handleStopRecording} style={{ padding: '6px 12px', fontSize: 9, width: 'auto' }}>
                        STOP
                    </button>
                </div>
            </div>
        );
    }

    // --- MODO: Preview Audio ---
    if (mode === 'preview-audio') {
        return (
            <div className="input-container" style={{ padding: '8px 12px', background: 'var(--pin-black)', borderTop: '0.5px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                <audio ref={audioPreviewRef} hidden />
                <div className="flex-1 flex items-center gap-2 min-w-0">
                    <button onClick={handlePlayPreview} style={{ background: 'transparent', border: 'none', color: '#fff', flexShrink: 0 }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 24 }}>play_circle</span>
                    </button>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 mb-1 overflow-hidden h-[16px]">
                            {Array.from({ length: 20 }, (_, i) => (
                                <div key={i} style={{
                                    width: 2, height: 4 + Math.random() * 12,
                                    background: 'rgba(255,255,255,0.3)', borderRadius: 1,
                                    flexShrink: 0
                                }} />
                            ))}
                        </div>
                        <span className="vault-subtitle" style={{ fontSize: 8, opacity: 0.5 }}>{formatDuration(previewAudioDuration)}</span>
                    </div>
                </div>
                <div className="flex gap-2 flex-shrink-0 items-center">
                    <button className="material-symbols-outlined" onClick={handleDiscardAudio} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 20 }}>delete</button>
                    <button onClick={handleSendAudio} style={{ background: '#fff', color: '#000', border: 'none', padding: '6px 12px', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 10 }}>
                        SEND
                    </button>
                </div>
            </div>
        );
    }

    // --- MODO: Preview Imagen ---
    // --- MODO: Preview Imagen ---
    if (mode === 'preview-image') {
        return (
            <div className="input-container" style={{ padding: '12px', background: 'var(--pin-black)', borderTop: '0.5px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                <div className="flex-1 flex items-center gap-3 min-w-0">
                    <div style={{ width: 40, height: 40, border: '0.5px solid #fff', overflow: 'hidden', flexShrink: 0 }}>
                        {isCompressing ? (
                            <div className="w-full h-full flex items-center justify-center bg-white/5">
                                <span className="material-symbols-outlined animate-spin" style={{ fontSize: 16 }}>sync</span>
                            </div>
                        ) : (
                            <img src={previewImageUrl || ''} alt="Preview" className="w-full h-full object-cover grayscale" />
                        )}
                    </div>
                    <div className="min-w-0">
                        <span className="vault-subtitle truncate block" style={{ fontSize: 10, color: '#fff' }}>IMAGE_READY</span>
                        <p className="vault-subtitle truncate block" style={{ fontSize: 8, color: '#aaa' }}>_v4.2_compressed</p>
                    </div>
                </div>
                <div className="flex gap-3 flex-shrink-0 items-center">
                    <button className="vault-btn-ghost" onClick={handleDiscardImage} style={{ color: 'rgba(255,255,255,0.4)', padding: 4 }}>
                        DEL
                    </button>
                    <button
                        onClick={handleSendImage}
                        disabled={isCompressing}
                        style={{
                            background: '#fff',
                            color: '#000',
                            border: 'none',
                            padding: '8px 16px',
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 700,
                            fontSize: 10,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap'
                        }}
                    >
                        SEND
                    </button>
                </div>
            </div>
        );
    }

    // --- MODO: Texto Normal (Estilo WhatsApp) ---
    return (
        <div className="relative">
            {/* Emoji/Sticker Panel */}
            {showEmojiPicker && (
                <div className="absolute bottom-full left-0 mb-4 bg-[#111] border border-white/10 p-2 z-[9999] shadow-2xl w-full max-w-[320px] animate-in slide-in-from-bottom-2 duration-200" style={{ height: 250, overflowY: 'auto' }}>
                    <div className="vault-subtitle mb-2" style={{ fontSize: 9, opacity: 0.5, textAlign: 'center' }}>ANIMATED_STICKERS_PACK_V1</div>
                    <div className="grid grid-cols-4 gap-2">
                        {['😂', '❤️', '🔥', '👍', '🎉', '👀', '💩', '🚀', '💀', '😭', '😍', '🤯', '👋', '🙅', '🤮', '🤖'].map(emoji => (
                            <button
                                key={emoji}
                                className="aspect-square flex items-center justify-center hover:bg-white/5 transition-colors group"
                                onClick={() => {
                                    onSend(emoji); // Send as solo emoji
                                    setShowEmojiPicker(false);
                                }}
                                style={{ border: 'none', background: 'transparent' }}
                            >
                                <span style={{ fontSize: 32, filter: 'drop-shadow(0 0 10px rgba(255,255,255,0.2))' }} className="group-hover:scale-125 transition-transform duration-200 group-hover:animate-bounce">
                                    {emoji}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Emoji/Sticker Panel */}
            {showEmojiPicker && (
                <div className="absolute bottom-full left-0 mb-4 bg-[#111] border border-white/10 p-2 z-[9999] shadow-2xl w-full max-w-[320px] animate-in slide-in-from-bottom-2 duration-200" style={{ height: 250, overflowY: 'auto' }}>
                    <div className="vault-subtitle mb-2" style={{ fontSize: 10, color: '#ccc', textAlign: 'center', letterSpacing: 1 }}>FLUENT_3D_STICKERS_PACK</div>
                    <div className="grid grid-cols-4 gap-2">
                        {[
                            { name: 'Risa', url: 'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Smilies/Grinning%20Squinting%20Face.png' },
                            { name: 'Amor', url: 'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Smilies/Smiling%20Face%20with%20Heart-Eyes.png' },
                            { name: 'Llanto', url: 'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Smilies/Loudly%20Crying%20Face.png' },
                            { name: 'Fuego', url: 'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Activities/Fire.png' },
                            { name: 'Bailando', url: 'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/People/Man%20Dancing.png' },
                            { name: 'Pensando', url: 'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Smilies/Thinking%20Face.png' },
                            { name: 'Sorpresa', url: 'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Smilies/Astonished%20Face.png' },
                            { name: 'Fiesta', url: 'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Smilies/Partying%20Face.png' },
                            { name: 'Cool', url: 'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Smilies/Smiling%20Face%20with%20Sunglasses.png' },
                            { name: 'Mindblown', url: 'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Smilies/Exploding%20Head.png' },
                            { name: 'Fantasma', url: 'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Smilies/Ghost.png' },
                            { name: 'Robot', url: 'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Smilies/Robot.png' }
                        ].map(sticker => (
                            <button
                                key={sticker.name}
                                className="aspect-square flex items-center justify-center transition-transform group p-2"
                                onClick={() => {
                                    // Send as image because they are PNGs
                                    onSendImage(sticker.url);
                                    setShowEmojiPicker(false);
                                }}
                                style={{ border: 'none', background: 'transparent' }}
                            >
                                <img
                                    src={sticker.url}
                                    alt={sticker.name}
                                    style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 0 5px rgba(255,255,255,0.2))' }}
                                    className="group-hover:scale-125 transition-transform duration-200 group-hover:animate-bounce"
                                />
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Popover Media Menu - TECH REDESIGN */}
            {showMediaMenu && (
                <div className="absolute bottom-full left-0 mb-4 bg-black border border-white/20 p-1 flex flex-col gap-1 z-[9999] shadow-2xl min-w-[240px] animate-in fade-in zoom-in-95 duration-200" style={{ borderRadius: 0 }}>
                    {showProductPicker ? (
                        <div className="flex flex-col gap-1 max-h-[300px] overflow-y-auto custom-scrollbar">
                            <button
                                className="flex items-center gap-2 p-3 hover:bg-white/10 text-white transition-colors"
                                onClick={() => setShowProductPicker(false)}
                                style={{ border: 'none', background: 'transparent', borderRadius: 0 }}
                            >
                                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_back</span>
                                <span className="vault-subtitle" style={{ fontSize: 9 }}>BACK_TO_ROOT</span>
                            </button>

                            {myProducts.length === 0 ? (
                                <div className="p-4 text-center">
                                    <span className="vault-subtitle" style={{ fontSize: 9, opacity: 0.5 }}>DATABASE_EMPTY</span>
                                </div>
                            ) : (
                                myProducts.map((p: LocalProduct) => (
                                    <button
                                        key={p.id}
                                        className="flex items-center gap-3 p-2 hover:bg-white/10 text-left text-white transition-colors"
                                        onClick={() => {
                                            const meta = JSON.stringify({
                                                name: p.name,
                                                price: p.price,
                                                imageUrl: p.imageUrl,
                                                productId: p.id
                                            });
                                            onSendProduct(meta);
                                            setShowMediaMenu(false);
                                        }}
                                        style={{ border: 'none', background: 'transparent', borderRadius: 0 }}
                                    >
                                        <div style={{ width: 32, height: 32, background: '#111', border: '1px solid #333' }}>
                                            <img src={p.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        </div>
                                        <div className="flex-1 overflow-hidden">
                                            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name.toUpperCase()}</div>
                                            <div style={{ fontSize: 9, color: '#00f2ff' }}>${p.price}</div>
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    ) : (
                        <>
                            {/* CAMARA REAL */}
                            <button className="flex items-center gap-4 px-4 py-3 hover:bg-white/10 transition-colors text-white group" onClick={() => {
                                // Input File con capture="environment"
                                const input = document.createElement('input');
                                input.type = 'file';
                                input.accept = 'image/*';
                                input.capture = 'environment'; // Abre cámara trasera directament
                                input.onchange = (e: any) => {
                                    const file = e.target.files[0];
                                    if (file) {
                                        // Reusar lógica de compresión
                                        const reader = new FileReader();
                                        reader.onload = (ev) => {
                                            setPreviewImageUrl(ev.target?.result as string);
                                            setMode('preview-image');
                                            setShowMediaMenu(false);
                                        };
                                        reader.readAsDataURL(file);
                                    }
                                };
                                input.click();
                            }} style={{ border: 'none', background: 'transparent', borderRadius: 0 }}>
                                <span className="material-symbols-outlined group-hover:text-[#ff3b30] transition-colors" style={{ fontSize: 20 }}>photo_camera</span>
                                <span className="vault-subtitle" style={{ fontSize: 10 }}>CAMARA_DIRECTA</span>
                            </button>

                            {/* GALERIA */}
                            <button className="flex items-center gap-4 px-4 py-3 hover:bg-white/10 transition-colors text-white group" onClick={handlePickImage} style={{ border: 'none', background: 'transparent', borderRadius: 0 }}>
                                <span className="material-symbols-outlined group-hover:text-[#00f2ff] transition-colors" style={{ fontSize: 20 }}>image</span>
                                <span className="vault-subtitle" style={{ fontSize: 10 }}>GALERIA_MEDIA</span>
                            </button>

                            {/* DOCUMENTO (Simulado) */}
                            <button className="flex items-center gap-4 px-4 py-3 hover:bg-white/10 transition-colors text-white group" onClick={() => {
                                // Simular input file
                                const input = document.createElement('input');
                                input.type = 'file';
                                input.accept = '.pdf,.doc,.docx,.txt';
                                input.onchange = (e: any) => {
                                    if (e.target.files[0]) alert(`[SYSTEM]: Archivo "${e.target.files[0].name}" listo para encriptar. (Demo)`);
                                    setShowMediaMenu(false);
                                };
                                input.click();
                            }} style={{ border: 'none', background: 'transparent', borderRadius: 0 }}>
                                <span className="material-symbols-outlined group-hover:text-[#b400ff] transition-colors" style={{ fontSize: 20 }}>description</span>
                                <span className="vault-subtitle" style={{ fontSize: 10 }}>DOCUMENTO_ENCRIPTADO</span>
                            </button>

                            {/* CONTACTO */}
                            <button className="flex items-center gap-4 px-4 py-3 hover:bg-white/10 transition-colors text-white group" onClick={() => {
                                onSend(`[CONTACT_CARD]: User_ID_${Math.floor(Math.random() * 9999)}`);
                                setShowMediaMenu(false);
                            }} style={{ border: 'none', background: 'transparent', borderRadius: 0 }}>
                                <span className="material-symbols-outlined group-hover:text-[#00ff9d] transition-colors" style={{ fontSize: 20 }}>person</span>
                                <span className="vault-subtitle" style={{ fontSize: 10 }}>COMPARTIR_CONTACTO</span>
                            </button>

                            {/* UBICACION */}
                            <button className="flex items-center gap-4 px-4 py-3 hover:bg-white/10 transition-colors text-white group" onClick={() => {
                                if ("geolocation" in navigator) {
                                    navigator.geolocation.getCurrentPosition((pos) => {
                                        // Format: [LOCATION]: lat,long
                                        onSend(`[LOCATION]: ${pos.coords.latitude},${pos.coords.longitude}`);
                                        setShowMediaMenu(false);
                                    }, (err) => {
                                        alert("Error obteniendo ubicación: " + err.message);
                                    });
                                } else {
                                    alert("Geolocalización no soportada");
                                }
                            }} style={{ border: 'none', background: 'transparent', borderRadius: 0 }}>
                                <span className="material-symbols-outlined group-hover:text-[#ff0055] transition-colors" style={{ fontSize: 20 }}>location_on</span>
                                <span className="vault-subtitle" style={{ fontSize: 10 }}>UBICACION_ACTUAL</span>
                            </button>

                            {/* AUDIOS */}
                            <button className="flex items-center gap-4 px-4 py-3 hover:bg-white/10 transition-colors text-white group" onClick={handleStartRecording} style={{ border: 'none', background: 'transparent', borderRadius: 0 }}>
                                <span className="material-symbols-outlined group-hover:text-[#ffd700] transition-colors" style={{ fontSize: 20 }}>mic</span>
                                <span className="vault-subtitle" style={{ fontSize: 10 }}>NOTA_DE_VOZ</span>
                            </button>

                            <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 0' }} />

                            {/* TIENDA */}
                            <button
                                className="flex items-center gap-4 px-4 py-3 hover:bg-white/20 transition-colors text-white"
                                onClick={() => setShowProductPicker(true)}
                                style={{ border: 'none', background: '#111', borderRadius: 0 }}
                            >
                                <span className="material-symbols-outlined text-[#00f2ff]" style={{ fontSize: 20 }}>storefront</span>
                                <span className="vault-subtitle" style={{ fontSize: 10, color: '#fff' }}>MI_CATALOGO</span>
                            </button>
                        </>
                    )}
                </div>
            )}

            <div className="input-container">
                {/* Botón Emoji */}
                <button
                    className="p-2 text-gray-400 hover:text-[#00f2ff] transition-colors"
                    onClick={() => {
                        setShowEmojiPicker(!showEmojiPicker);
                        setShowMediaMenu(false);
                    }}
                >
                    <span className="material-symbols-outlined" style={{ fontSize: 26 }}>mood</span>
                </button>

                {/* Botón Adjuntar */}
                <button
                    className={`p-2 transition-all duration-200 ${showMediaMenu ? 'rotate-45 text-[#00f2ff]' : 'text-gray-400 hover:text-white'}`}
                    onClick={() => {
                        setShowMediaMenu(!showMediaMenu);
                        setShowEmojiPicker(false);
                    }}
                >
                    <span className="material-symbols-outlined" style={{ fontSize: 26 }}>add_circle</span>
                </button>

                {/* Área de Texto (Línea de escritura) */}
                <div className="wa-input-wrapper">
                    <textarea
                        ref={textareaRef}
                        className="chat-input-textarea"
                        placeholder="Escribe un mensaje..."
                        value={text}
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                        onFocus={() => setShowMediaMenu(false)}
                        rows={1}
                        disabled={disabled}
                    />
                </div>

                {/* Botón Acción (Círculo Negro) */}
                {text.trim() ? (
                    <button className="wa-mic-circle" onClick={handleSendText} disabled={disabled}>
                        <span className="material-symbols-outlined" style={{ fontSize: 24 }}>send</span>
                    </button>
                ) : (
                    <button
                        className="wa-mic-circle"
                        onClick={handleStartRecording}
                        disabled={disabled}
                    >
                        <span className="material-symbols-outlined" style={{ fontSize: 24 }}>mic</span>
                    </button>
                )}
            </div>
        </div>
    );
}
);

export default ChatInput;
