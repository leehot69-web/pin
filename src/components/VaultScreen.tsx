/**
 * VaultScreen — Pantalla de Entrada de Seguridad
 * 
 * Implementa autenticación por correo (OTP) + Bóveda de PIN
 * Incluye modo Bypass para pruebas de desarrollo.
 */

'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { usePinStore } from '@/store/pinStore';
import { useSignalProtocol } from '@/hooks/useSignalProtocol';
import { pinDb } from '@/lib/db';
import { crossTab } from '@/lib/crossTab';
import { supabase } from '@/lib/supabase';
import { setupDemoPair } from '@/lib/seed';

type Step = 'email' | 'otp' | 'identity_choice' | 'pin_access' | 'pin_create';

export default function VaultScreen() {
    const [step, setStep] = useState<Step>('email');
    const [email, setEmail] = useState('');
    const [otp, setOtp] = useState('');
    const [pinValue, setPinValue] = useState('');
    const [honeypot, setHoneypot] = useState(''); // Anti-bot
    const [status, setStatus] = useState<'idle' | 'verifying' | 'success' | 'error' | 'creating'>('idle');
    const [statusText, setStatusText] = useState('');

    const inputRef = useRef<HTMLInputElement>(null);
    const otpRef = useRef<HTMLInputElement>(null);

    const { setCurrentScreen, setIdentity } = usePinStore();
    const { createIdentity, loadIdentity, registerOnServer, signInWithEmail, verifyOtp } = useSignalProtocol();

    // Persistencia de sesión
    useEffect(() => {
        const checkSession = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            const keys = await pinDb.getAllKeys();

            if (session) {
                if (keys.length > 0) {
                    setStep('pin_access');
                    setPinValue(keys[0].pin);
                } else {
                    setStep('identity_choice');
                }
            } else if (keys.length > 0) {
                // Si hay llaves pero no sesión (ej: desarrollo local)
                setStep('pin_access');
                setPinValue(keys[0].pin);
            }
        };
        checkSession();
    }, []);

    const artificialHandshake = async (text: string) => {
        setStatus('verifying');
        setStatusText(text);
        await new Promise(r => setTimeout(r, 1500));
    };

    // ========== PASO 1: ENVIAR CORREO ==========
    const handleEmailSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (honeypot) return;

        if (!email.includes('@')) {
            setStatus('error');
            setStatusText('CORREO_INVALIDO');
            return;
        }

        await artificialHandshake('[SOLICITANDO_ACCESO_NODO...]');

        const { error } = await signInWithEmail(email);
        if (error) {
            setStatus('error');
            setStatusText(error.toUpperCase());
        } else {
            setStep('otp');
            setStatus('idle');
            setStatusText('CODIGO_ENVIADO');
        }
    };

    // ========== PASO 2: VERIFICAR OTP ==========
    const handleOtpSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (otp.length !== 6) return;

        await artificialHandshake('[VALIDANDO_IDENTIDAD...]');

        const { error } = await verifyOtp(email, otp);
        if (error) {
            setStatus('error');
            setStatusText('CODIGO_INVALIDO');
        } else {
            const { data: { user } } = await supabase.auth.getUser();
            const { data: profile } = await supabase
                .from('profiles')
                .select('pin_id')
                .eq('id', user?.id)
                .single();

            if (profile) {
                const keys = await pinDb.getKeys(profile.pin_id);
                if (keys) {
                    setStep('pin_access');
                    setPinValue(profile.pin_id);
                } else {
                    setStep('identity_choice');
                }
            } else {
                setStep('pin_create');
                handleCreateIdentity();
            }
            setStatus('idle');
        }
    };

    // ========== BYPASS PARA PRUEBAS ==========
    const handleBypass = async () => {
        const keys = await pinDb.getAllKeys();
        if (keys.length > 0) {
            setStep('pin_access');
            setPinValue(keys[0].pin);
        } else {
            setStep('pin_create');
            handleCreateIdentity();
        }
    };

    const handleResetApp = async () => {
        if (!confirm('PROTOCOL_WARNING:\n\nEsto borrará permanentemente tu identidad local (PIN) y mensajes.\n\n¿CONFIRMAS EL REINICIO DEL NODO?')) return;

        try {
            // @ts-ignore
            if (window.indexedDB.databases) {
                // @ts-ignore
                const dbs = await window.indexedDB.databases();
                // @ts-ignore
                for (const db of dbs) {
                    if (db.name) window.indexedDB.deleteDatabase(db.name);
                }
            }
        } catch (e) {
            console.error('Wipe failed', e);
        }

        // Fallback always
        window.indexedDB.deleteDatabase('pinchat-db');

        // Clear Storage
        localStorage.clear();

        // Reload
        window.location.reload();
    };

    const handleQuickLogin = async (demoPin: string) => {
        setPinValue(demoPin);
        setStatus('verifying');
        await artificialHandshake('[ACCESO_TOTAL_DEMO...]');
        setIdentity({
            pin: demoPin,
            userId: `demo-${demoPin}`,
            identityKeyPub: 'demo-key',
            isAuthenticated: true
        });
        const other = demoPin === '11111111' ? '22222222' : '11111111';
        await setupDemoPair(demoPin, other);

        setStatus('success');
        crossTab.init(demoPin);
        await new Promise(r => setTimeout(r, 600));
        setCurrentScreen('chats');
    };

    const handleAccess = useCallback(async () => {
        if (pinValue.length !== 8) return;

        // --- QUICK DEMO USERS ---
        if (pinValue === '11111111' || pinValue === '22222222') {
            await handleQuickLogin(pinValue);
            return;
        }

        await artificialHandshake('[DESCIFRANDO_BOVEDA...]');
        const loaded = await loadIdentity(pinValue);

        if (loaded) {
            setStatusText('[ESTABLECIENDO_SESION...]');
            await registerOnServer(pinValue);

            // FORCE SET IDENTITY
            setIdentity({
                pin: pinValue,
                userId: 'local-user',
                identityKeyPub: 'dummy',
                isAuthenticated: true
            });

            setStatus('success');
            crossTab.init(pinValue);
            await new Promise(r => setTimeout(r, 600));
            setCurrentScreen('chats');
        } else {
            setStatus('error');
            setStatusText('ACCESO_DENEGADO_NODO_INCORRECTO');
        }
    }, [pinValue, loadIdentity, registerOnServer, setCurrentScreen]);

    // ========== CREAR IDENTIDAD ==========
    const handleCreateIdentity = useCallback(async () => {
        setStatus('creating');
        setStatusText('[GENERANDO_RECURSOS_E2EE...]');

        try {
            const { pin } = await createIdentity();
            setPinValue(pin);
            await registerOnServer(pin);

            setIdentity({
                pin,
                userId: 'local-user',
                identityKeyPub: 'dummy',
                isAuthenticated: true
            });

            setStatus('success');
            setStatusText(`IDENTIDAD_LISTA: ${pin}`);
            crossTab.init(pin);
            await new Promise(r => setTimeout(r, 1200));
            setCurrentScreen('chats');
        } catch {
            setStatus('error');
            setStatusText('ERROR_AL_GENERAR_NODO');
        }
    }, [createIdentity, registerOnServer, setCurrentScreen]);

    const [revealedIndices, setRevealedIndices] = useState<Set<number>>(new Set());
    const handleSegmentTouch = (index: number) => {
        setRevealedIndices(prev => new Set(prev).add(index));
        setTimeout(() => setRevealedIndices(prev => {
            const next = new Set(prev);
            next.delete(index);
            return next;
        }), 1200);
    };

    // ========== VISTAS ==========

    const renderEmailStep = () => (
        <div className="vault-screen animate-in fade-in duration-500">
            <div className="vault-logo">
                <img
                    src="https://github.com/leehot69-web/pin/blob/master/Gemini_Generated_Image_fxd2lufxd2lufxd2-removebg-preview.png?raw=true"
                    alt="Logo"
                    style={{ width: 120, height: 'auto', marginBottom: 16 }}
                />
                <span className="vault-subtitle">RED_DE_NODOS_CIFRADOS</span>
            </div>

            <form onSubmit={handleEmailSubmit} style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div className="settings-group">
                    <div className="settings-group-label" style={{ fontSize: 9 }}>_email_anchor_point</div>
                    <input
                        type="email"
                        placeholder="usuario@dominio.com"
                        className="vault-input"
                        style={{ width: '100%', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', padding: 16, color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 13, borderRadius: 0 }}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />
                    <input type="text" style={{ display: 'none' }} value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <button type="submit" className="vault-btn primary" disabled={status === 'verifying'}>
                        {status === 'verifying' ? 'CONECTANDO...' : 'SOLICITAR_LLAVE'}
                    </button>

                    <button type="button" className="vault-btn-ghost" onClick={handleBypass} style={{ border: '1px solid rgba(255,255,255,0.1)', padding: 12 }}>
                        [ MODO_PRUEBA / SALTAR ]
                    </button>
                </div>

                <p className="vault-subtitle" style={{ fontSize: 8, opacity: 0.3, textAlign: 'center', lineHeight: 1.6 }}>
                    EL CORREO ES UNA ANCLA DE SEGURIDAD. <br />
                    NO SE REGISTRA ACTIVIDAD NI SE GUARDAN MENSAJES EN EL SERVIDOR.
                </p>
            </form>

            {statusText && <div className={`vault-status ${status}`} style={{ padding: '8px 16px', border: '0.5px solid currentColor' }}>{statusText}</div>}
        </div>
    );

    const renderOtpStep = () => (
        <div className="vault-screen">
            <div className="vault-logo">
                <img
                    src="https://github.com/leehot69-web/pin/blob/master/Gemini_Generated_Image_fxd2lufxd2lufxd2-removebg-preview.png?raw=true"
                    alt="Logo"
                    style={{ width: 80, height: 'auto', marginBottom: 16 }}
                />
                <span className="vault-subtitle">LLAVE_TEMPORAL</span>
            </div>

            <form onSubmit={handleOtpSubmit} style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 32, alignItems: 'center' }}>
                <span className="vault-subtitle" style={{ fontSize: 8, opacity: 0.5 }}>IDENTIFICANDO NODO: {email.toUpperCase()}</span>

                <input
                    ref={otpRef}
                    type="text"
                    maxLength={6}
                    className="w-full text-center bg-transparent border-b-2 border-[#fff] text-[#fff] text-4xl tracking-[24px] outline-none font-mono py-4"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                    autoFocus
                />

                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <button type="submit" className="vault-btn primary" disabled={otp.length !== 6 || status === 'verifying'}>
                        VERIFICAR_ACCESO
                    </button>
                    <button type="button" className="vault-btn-ghost" onClick={() => setStep('email')}>
                        _cancelar_handshake
                    </button>
                </div>
            </form>

            {statusText && <div className={`vault-status ${status}`}>{statusText}</div>}
        </div>
    );

    const renderPinStep = () => (
        <div className="vault-screen">
            <div className="vault-logo" style={{ marginTop: 40 }}>
                <img
                    src="https://github.com/leehot69-web/pin/blob/master/Gemini_Generated_Image_fxd2lufxd2lufxd2-removebg-preview.png?raw=true"
                    alt="Logo"
                    style={{ width: 100, height: 'auto', marginBottom: 16 }}
                />
                <h1 className="vault-title" style={{ fontSize: 24, letterSpacing: 2 }}>{step === 'pin_create' ? 'NUEVO_NODO' : 'SYSTEM_ACCESS'}</h1>
            </div>

            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
                <span className="vault-subtitle" style={{ fontSize: 8, opacity: 0.4 }}>_verificacion_de_integridad_del_nodo...</span>

                <div className="pin-input-container">
                    {Array.from({ length: 8 }).map((_, i) => {
                        const isFilled = i < pinValue.length;
                        const isRevealed = revealedIndices.has(i);
                        return (
                            <div
                                key={i}
                                className={`pin-segment ${i === pinValue.length ? 'active' : ''} ${isFilled ? 'filled' : ''} ${isRevealed ? 'revealed' : ''}`}
                                onClick={() => inputRef.current?.focus()}
                                style={{ border: '1px solid rgba(255,255,255,0.4)', background: isFilled ? 'rgba(255,255,255,0.05)' : 'transparent' }}
                            >
                                {isFilled ? (isRevealed ? pinValue[i] : '•') : ''}
                            </div>
                        );
                    })}
                </div>

                <input
                    ref={inputRef}
                    className="pin-hidden-input"
                    type="text"
                    value={pinValue}
                    onChange={(e) => {
                        const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
                        if (val.length > pinValue.length) {
                            handleSegmentTouch(val.length - 1);
                        }
                        setPinValue(val);
                    }}
                    maxLength={8}
                    autoFocus
                />

                <div className="vault-actions" style={{ marginTop: 16 }}>
                    <button className="vault-btn primary" onClick={handleAccess} disabled={pinValue.length !== 8 || status === 'verifying'}>
                        {status === 'verifying' ? 'DESCIFRANDO...' : 'INTRO'}
                    </button>
                    <button className="vault-btn-ghost" onClick={() => setStep('email')}>
                        _cambiar_identidad
                    </button>
                    <button className="vault-btn-ghost" onClick={handleResetApp} style={{ color: '#ff4444', borderColor: 'rgba(255, 68, 68, 0.3)' }}>
                        DESTRUIR_IDENTIDAD
                    </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 20, width: '100%' }}>
                    <button onClick={() => handleQuickLogin('11111111')} className="vault-btn-ghost" style={{ border: '1px solid #4CAF50', color: '#4CAF50', fontSize: 10 }}>
                        [ ENT_USER_A (1111) ]
                    </button>
                    <button onClick={() => handleQuickLogin('22222222')} className="vault-btn-ghost" style={{ border: '1px solid #2196F3', color: '#2196F3', fontSize: 10 }}>
                        [ ENT_USER_B (2222) ]
                    </button>
                </div>
            </div>

            {statusText && <div className={`vault-status ${status}`} style={{ marginTop: 20 }}>{statusText}</div>}
        </div>
    );

    if (step === 'email') return renderEmailStep();
    if (step === 'otp') return renderOtpStep();
    return renderPinStep();
}
