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
            <div className="input-container" style={{ padding: '8px 16px', background: 'var(--pin-black)', borderTop: '0.5px solid rgba(255,255,255,0.1)' }}>
                <div className="flex-1 flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#ff4444', animation: 'pulse 1.5s infinite' }}>mic</span>
                        <span className="vault-subtitle" style={{ fontSize: 10, letterSpacing: 2 }}>{formatDuration(recordTime)}</span>
                    </div>
                    <span className="vault-subtitle" style={{ fontSize: 8, opacity: 0.4 }}>_capturing_audio_stream...</span>
                </div>
                <div className="flex gap-4">
                    <button className="vault-btn-ghost" onClick={handleCancelRecording} style={{ color: 'rgba(255,255,255,0.4)' }}>
                        _cancel
                    </button>
                    <button className="vault-btn" onClick={handleStopRecording} style={{ padding: '6px 12px', fontSize: 9 }}>
                        _stop_record
                    </button>
                </div>
            </div>
        );
    }

    // --- MODO: Preview Audio ---
    if (mode === 'preview-audio') {
        return (
            <div className="input-container" style={{ padding: '8px 16px', background: 'var(--pin-black)', borderTop: '0.5px solid rgba(255,255,255,0.1)' }}>
                <audio ref={audioPreviewRef} hidden />
                <div className="flex-1 flex items-center gap-4">
                    <button onClick={handlePlayPreview} style={{ background: 'transparent', border: 'none', color: '#fff' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 24 }}>play_circle</span>
                    </button>
                    <div className="flex-1">
                        <div className="flex items-center gap-1 mb-1">
                            {Array.from({ length: 30 }, (_, i) => (
                                <div key={i} style={{
                                    width: 2, height: 4 + Math.random() * 12,
                                    background: 'rgba(255,255,255,0.3)', borderRadius: 1
                                }} />
                            ))}
                        </div>
                        <span className="vault-subtitle" style={{ fontSize: 8, opacity: 0.5 }}>{formatDuration(previewAudioDuration)} · _ready_to_transmit</span>
                    </div>
                </div>
                <div className="flex gap-3">
                    <button className="material-symbols-outlined" onClick={handleDiscardAudio} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 20 }}>delete</button>
                    <button className="send-btn-label" onClick={handleSendAudio}>
                        SEND_FILE
                    </button>
                </div>
            </div>
        );
    }

    // --- MODO: Preview Imagen ---
    if (mode === 'preview-image') {
        return (
            <div className="input-container" style={{ padding: '12px 16px', background: 'var(--pin-black)', borderTop: '0.5px solid rgba(255,255,255,0.1)' }}>
                <div className="flex-1 flex items-center gap-4">
                    <div style={{ width: 44, height: 44, border: '0.5px solid #fff', overflow: 'hidden' }}>
                        {isCompressing ? (
                            <div className="w-full h-full flex items-center justify-center bg-white/5">
                                <span className="material-symbols-outlined animate-spin" style={{ fontSize: 16 }}>sync</span>
                            </div>
                        ) : (
                            <img src={previewImageUrl || ''} alt="Preview" className="w-full h-full object-cover grayscale" />
                        )}
                    </div>
                    <div>
                        <span className="vault-subtitle" style={{ fontSize: 10 }}>IMAGE_PAYLOAD_READY</span>
                        <p className="vault-subtitle" style={{ fontSize: 7, opacity: 0.4 }}>_compression_algorithm_v4.2_applied</p>
                    </div>
                </div>
                <div className="flex gap-4">
                    <button className="vault-btn-ghost" onClick={handleDiscardImage} style={{ color: 'rgba(255,255,255,0.4)' }}>
                        _discard
                    </button>
                    <button className="send-btn-label" onClick={handleSendImage} disabled={isCompressing}>
                        TRANSMIT
                    </button>
                </div>
            </div>
        );
    }

    // --- MODO: Texto Normal (Estilo WhatsApp) ---
    return (
        <div className="relative">
            {/* Popover Media Menu */}
            {showMediaMenu && (
                <div className="absolute bottom-full left-0 mb-4 bg-white border border-gray-200 rounded-3xl p-3 flex flex-col gap-1 z-[9999] shadow-2xl min-w-[220px]">
                    {showProductPicker ? (
                        <div className="flex flex-col gap-1 max-h-[300px] overflow-y-auto">
                            <button
                                className="flex items-center gap-2 p-2 hover:bg-gray-100 rounded-xl mb-2 text-black"
                                onClick={() => setShowProductPicker(false)}
                                style={{ border: 'none', background: 'transparent' }}
                            >
                                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_back</span>
                                <span className="vault-subtitle" style={{ fontSize: 9, fontWeight: 700 }}>VOLVER</span>
                            </button>

                            {myProducts.length === 0 ? (
                                <div className="p-4 text-center">
                                    <span className="vault-subtitle" style={{ fontSize: 9, opacity: 0.5 }}>SIN_PRODUCTOS</span>
                                    <div className="vault-subtitle" style={{ fontSize: 7, opacity: 0.3, marginTop: 4 }}>CONFIGURA_TU_TIENDA_EN_AJUSTES</div>
                                </div>
                            ) : (
                                myProducts.map((p: LocalProduct) => (
                                    <button
                                        key={p.id}
                                        className="flex items-center gap-3 p-2 hover:bg-gray-100 rounded-2xl text-left text-black"
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
                                        style={{ border: 'none', background: 'transparent' }}
                                    >
                                        <div style={{ width: 40, height: 40, background: '#eee', borderRadius: 8, overflow: 'hidden' }}>
                                            <img src={p.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        </div>
                                        <div className="flex-1 overflow-hidden">
                                            <div style={{ fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name.toUpperCase()}</div>
                                            <div style={{ fontSize: 9, color: '#2196F3', fontWeight: 700 }}>${p.price}</div>
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    ) : (
                        <>
                            <button className="flex items-center gap-4 px-4 py-3 hover:bg-gray-100 rounded-2xl transition-colors text-black" onClick={handlePickImage} style={{ border: 'none', background: 'transparent' }}>
                                <span className="material-symbols-outlined" style={{ fontSize: 24, color: '#2196F3' }}>image</span>
                                <span className="vault-subtitle" style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1 }}>GALERIA</span>
                            </button>
                            <button className="flex items-center gap-4 px-4 py-3 hover:bg-gray-100 rounded-2xl transition-colors text-black" onClick={() => alert('Feature coming soon')} style={{ border: 'none', background: 'transparent' }}>
                                <span className="material-symbols-outlined" style={{ fontSize: 24, color: '#4CAF50' }}>description</span>
                                <span className="vault-subtitle" style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1 }}>DOCUMENTO</span>
                            </button>
                            <button className="flex items-center gap-4 px-4 py-3 hover:bg-gray-100 rounded-2xl transition-colors text-black" onClick={() => alert('Feature coming soon')} style={{ border: 'none', background: 'transparent' }}>
                                <span className="material-symbols-outlined" style={{ fontSize: 24, color: '#FF9800' }}>person</span>
                                <span className="vault-subtitle" style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1 }}>CONTACTO</span>
                            </button>
                            <button className="flex items-center gap-4 px-4 py-3 hover:bg-gray-100 rounded-2xl transition-colors text-black" onClick={() => alert('Feature coming soon')} style={{ border: 'none', background: 'transparent' }}>
                                <span className="material-symbols-outlined" style={{ fontSize: 24, color: '#F44336' }}>location_on</span>
                                <span className="vault-subtitle" style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1 }}>UBICACION</span>
                            </button>
                            <button className="flex items-center gap-4 px-4 py-3 hover:bg-gray-100 rounded-2xl transition-colors text-black" onClick={() => alert('Feature coming soon')} style={{ border: 'none', background: 'transparent' }}>
                                <span className="material-symbols-outlined" style={{ fontSize: 24, color: '#9C27B0' }}>headset</span>
                                <span className="vault-subtitle" style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1 }}>AUDIOS</span>
                            </button>
                            <div style={{ height: 1, background: '#eee', margin: '4px 0' }} />
                            <button
                                className="flex items-center gap-4 px-4 py-3 bg-black hover:bg-gray-800 rounded-2xl transition-colors text-white"
                                onClick={() => setShowProductPicker(true)}
                                style={{ border: 'none' }}
                            >
                                <span className="material-symbols-outlined" style={{ fontSize: 24, color: '#FFD700' }}>storefront</span>
                                <span className="vault-subtitle" style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: 1 }}>MY_TIENDA</span>
                            </button>
                        </>
                    )}
                </div>
            )}

            <div className="input-container">
                {/* Botón Adjuntar (Círculo Blanco) */}
                <button
                    className="wa-icon-circle"
                    onClick={() => setShowMediaMenu(!showMediaMenu)}
                    disabled={disabled}
                >
                    <span className="material-symbols-outlined" style={{ fontSize: 24 }}>
                        {showMediaMenu ? 'close' : 'add'}
                    </span>
                </button>

                {/* Botón Cámara (Círculo Blanco) */}
                <button
                    className="wa-icon-circle"
                    onClick={handleCaptureCamera}
                    disabled={disabled}
                >
                    <span className="material-symbols-outlined" style={{ fontSize: 24 }}>photo_camera</span>
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
