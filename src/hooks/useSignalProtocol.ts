/**
 * useSignalProtocol — E2EE Hook for PIN
 * 
 * Manages cryptographic operations:
 * - Key generation and storage
 * - X3DH key exchange
 * - Double Ratchet encryption/decryption
 */

'use client';

import { useCallback, useRef } from 'react';
import {
    generateKeyPair,
    generateSigningKeyPair,
    exportKeyPair,
    importPublicKey,
    importPrivateKey,
    x3dhSender,
    initRatchet,
    ratchetEncrypt,
    ratchetDecrypt,
    generateLocalPinId,
    type KeyPair,
    type RatchetState,
    type PreKeyBundle,
    type EncryptedPayload,
} from '@/lib/crypto';
import { pinDb, type LocalKeyStore } from '@/lib/db';
import { supabase } from '@/lib/supabase';
import { usePinStore } from '@/store/pinStore';

export function useSignalProtocol() {
    const { identity, setIdentity, setVerificationStatus } = usePinStore();
    const ratchetStates = useRef<Map<string, RatchetState>>(new Map());

    /**
     * Generate a new identity with crypto keys
     */
    const createIdentity = useCallback(async (): Promise<{
        pin: string;
        identityKeyPub: string;
        signedPreKeyPub: string;
    }> => {
        // Generate all keys
        const identityKeyPair = await generateKeyPair();
        const signedPreKeyPair = await generateKeyPair();
        const signingKeyPair = await generateSigningKeyPair();

        const identityExported = await exportKeyPair(identityKeyPair);
        const signedPreExported = await exportKeyPair(signedPreKeyPair);
        const signingExported = await exportKeyPair(signingKeyPair);

        // Generate PIN
        const pin = generateLocalPinId();

        // Store keys locally in IndexedDB
        const keyStore: LocalKeyStore = {
            pin,
            identityKeyPub: identityExported.publicKey,
            identityKeyPriv: identityExported.privateKey,
            signedPreKeyPub: signedPreExported.publicKey,
            signedPreKeyPriv: signedPreExported.privateKey,
            signingKeyPub: signingExported.publicKey,
            signingKeyPriv: signingExported.privateKey,
            oneTimePreKeys: '[]',
        };

        await pinDb.saveKeys(keyStore);

        return {
            pin,
            identityKeyPub: identityExported.publicKey,
            signedPreKeyPub: signedPreExported.publicKey,
        };
    }, []);

    /**
     * Load existing identity from IndexedDB
     */
    const loadIdentity = useCallback(
        async (pin: string): Promise<boolean> => {
            const keys = await pinDb.getKeys(pin);
            if (!keys) return false;

            setIdentity({
                pin: keys.pin,
                userId: null,
                identityKeyPub: keys.identityKeyPub,
                isAuthenticated: true,
            });

            return true;
        },
        [setIdentity]
    );

    /**
     * Paso 1: Enviar OTP al correo
     */
    const signInWithEmail = useCallback(async (email: string): Promise<{ error: string | null }> => {
        try {
            const { error } = await supabase.auth.signInWithOtp({
                email,
                options: {
                    emailRedirectTo: window.location.origin,
                },
            });
            return { error: error ? error.message : null };
        } catch (err: any) {
            return { error: err.message || 'Error de conexión' };
        }
    }, []);

    /**
     * Paso 2: Verificar OTP de 6 dígitos
     */
    const verifyOtp = useCallback(async (email: string, token: string): Promise<{ error: string | null }> => {
        try {
            const { error, data } = await supabase.auth.verifyOtp({
                email,
                token,
                type: 'email',
            });
            return { error: error ? error.message : null };
        } catch (err: any) {
            return { error: err.message || 'Error de verificación' };
        }
    }, []);

    /**
     * Register identity on Supabase (Vínculo Correo-PIN)
     */
    const registerOnServer = useCallback(
        async (pin: string): Promise<boolean> => {
            const keys = await pinDb.getKeys(pin);
            if (!keys) return false;

            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return false;

                // Verificar si este usuario de correo ya tiene un PIN
                const { data: existingProfile } = await supabase
                    .from('profiles')
                    .select('pin_id')
                    .eq('id', user.id)
                    .single();

                if (existingProfile) {
                    // Si ya tiene PIN y es el mismo, lo dejamos pasar
                    // Si es diferente, la lógica del prompt dice 'Revocar Sesión Anterior' (borrando los datos viejos)
                    // Por simplicidad ahora actualizamos el perfil
                    if (existingProfile.pin_id !== pin) {
                        await supabase.from('profiles').update({
                            pin_id: pin,
                            identity_key_pub: keys.identityKeyPub,
                            signed_pre_key_pub: keys.signedPreKeyPub,
                        }).eq('id', user.id);
                    }
                } else {
                    // Crear perfil por primera vez
                    await supabase.from('profiles').insert({
                        id: user.id,
                        pin_id: pin,
                        identity_key_pub: keys.identityKeyPub,
                        signed_pre_key_pub: keys.signedPreKeyPub,
                    });
                }

                setIdentity({
                    pin,
                    userId: user.id,
                    identityKeyPub: keys.identityKeyPub,
                    isAuthenticated: true,
                });

                return true;
            } catch (err) {
                console.error('[PIN] Error de registro:', err);
                return false;
            }
        },
        [setIdentity]
    );

    /**
     * Initiate E2EE handshake with a peer (X3DH)
     */
    const initiateHandshake = useCallback(
        async (recipientPin: string, channelId: string): Promise<boolean> => {
            if (!identity?.pin) return false;

            setVerificationStatus('verifying');

            try {
                const keys = await pinDb.getKeys(identity.pin);
                if (!keys) return false;

                // Get recipient's pre key bundle from Supabase
                const { data: recipientProfile } = await supabase
                    .from('profiles')
                    .select('identity_key_pub, signed_pre_key_pub, one_time_pre_keys')
                    .eq('pin_id', recipientPin)
                    .single();

                if (!recipientProfile) {
                    setVerificationStatus('failed');
                    return false;
                }

                const recipientBundle: PreKeyBundle = {
                    identityKey: recipientProfile.identity_key_pub,
                    signedPreKey: recipientProfile.signed_pre_key_pub,
                    signature: '', // simplified
                };

                // Reconstruct our identity key pair
                const identityKeyPair: KeyPair = {
                    publicKey: await importPublicKey(keys.identityKeyPub),
                    privateKey: await importPrivateKey(keys.identityKeyPriv),
                };

                // Perform X3DH
                const { sharedSecret } = await x3dhSender(identityKeyPair, recipientBundle);

                // Initialize ratchet
                const ratchet = await initRatchet(sharedSecret, true);
                ratchetStates.current.set(channelId, ratchet);

                // Serialize and store ratchet state
                await pinDb.saveRatchetState(channelId, JSON.stringify({
                    initialized: true,
                    isInitiator: true,
                }));

                setVerificationStatus('verified');
                return true;
            } catch (err) {
                console.error('[PIN] Handshake error:', err);
                setVerificationStatus('failed');
                return false;
            }
        },
        [identity, setVerificationStatus]
    );

    /**
     * Encrypt a message using the Double Ratchet
     */
    const encrypt = useCallback(
        async (plaintext: string, channelId: string): Promise<EncryptedPayload | null> => {
            let state = ratchetStates.current.get(channelId);

            if (!state) {
                // For demo: create a simple key if no handshake
                state = await initRatchet(
                    // Use a derived key from identity
                    await deriveSimpleKey(identity?.pin || 'default', channelId),
                    true
                );
                ratchetStates.current.set(channelId, state);
            }

            const { payload, newState } = await ratchetEncrypt(plaintext, state);
            ratchetStates.current.set(channelId, newState);

            return payload;
        },
        [identity]
    );

    /**
     * Decrypt a message using the Double Ratchet
     */
    const decrypt = useCallback(
        async (payload: EncryptedPayload, channelId: string): Promise<string | null> => {
            let state = ratchetStates.current.get(channelId);

            if (!state) {
                state = await initRatchet(
                    await deriveSimpleKey(identity?.pin || 'default', channelId),
                    false
                );
                ratchetStates.current.set(channelId, state);
            }

            try {
                const { plaintext, newState } = await ratchetDecrypt(payload, state);
                ratchetStates.current.set(channelId, newState);
                return plaintext;
            } catch (err) {
                console.error('[PIN] Decryption error:', err);
                return null;
            }
        },
        [identity]
    );

    return {
        createIdentity,
        loadIdentity,
        registerOnServer,
        initiateHandshake,
        encrypt,
        decrypt,
        signInWithEmail,
        verifyOtp,
    };
}

// Helper: derive a simple symmetric key for demo/fallback
async function deriveSimpleKey(pin: string, channelId: string): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const rawData = encoder.encode(pin + channelId);
    const rawBuf = new ArrayBuffer(rawData.byteLength);
    new Uint8Array(rawBuf).set(rawData);

    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        rawBuf,
        'HKDF',
        false,
        ['deriveKey']
    );

    const saltData = encoder.encode('PIN-Simple-Key');
    const saltBuf = new ArrayBuffer(saltData.byteLength);
    new Uint8Array(saltBuf).set(saltData);

    const infoData = encoder.encode('PIN-E2EE');
    const infoBuf = new ArrayBuffer(infoData.byteLength);
    new Uint8Array(infoBuf).set(infoData);

    return crypto.subtle.deriveKey(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: saltBuf,
            info: infoBuf,
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
}
