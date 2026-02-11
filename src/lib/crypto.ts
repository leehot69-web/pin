/**
 * PIN Crypto Service — Signal Protocol adaptation using Web Crypto API
 * 
 * Implements:
 * - X3DH (Extended Triple Diffie-Hellman) key exchange
 * - Double Ratchet for Forward Secrecy
 * - AES-GCM-256 for message encryption
 * - Encrypt-then-MAC pattern
 * 
 * NOTE: Web Crypto API uses P-256 (ECDH) instead of Curve25519,
 * because subtle.generateKey doesn't natively support Curve25519 in all browsers.
 */

// ========== Types ==========

export interface KeyPair {
    publicKey: CryptoKey;
    privateKey: CryptoKey;
}

export interface ExportedKeyPair {
    publicKey: string; // base64
    privateKey: string; // base64
}

export interface PreKeyBundle {
    identityKey: string;
    signedPreKey: string;
    oneTimePreKey?: string;
    signature: string;
}

export interface RatchetState {
    rootKey: CryptoKey;
    sendingChainKey: CryptoKey | null;
    receivingChainKey: CryptoKey | null;
    sendingRatchetKey: KeyPair | null;
    receivingRatchetKey: CryptoKey | null;
    sendCount: number;
    receiveCount: number;
}

export interface EncryptedPayload {
    ciphertext: string;   // base64
    iv: string;           // base64
    tag: string;          // authentication tag (included in AES-GCM)
    ratchetPub: string;   // sender's current ratchet public key
    messageNumber: number;
}

// ========== Key Generation ==========

const ECDH_PARAMS: EcKeyGenParams = {
    name: 'ECDH',
    namedCurve: 'P-256',
};

const ECDSA_PARAMS: EcKeyGenParams = {
    name: 'ECDSA',
    namedCurve: 'P-256',
};

const AES_PARAMS: AesKeyGenParams = {
    name: 'AES-GCM',
    length: 256,
};

/**
 * Generate an ECDH key pair (Identity Key or Pre Key)
 */
export async function generateKeyPair(): Promise<KeyPair> {
    const keyPair = await crypto.subtle.generateKey(
        ECDH_PARAMS,
        true, // extractable
        ['deriveBits', 'deriveKey']
    );
    return {
        publicKey: keyPair.publicKey,
        privateKey: keyPair.privateKey,
    };
}

/**
 * Generate an ECDSA signing key pair (for signing pre keys)
 */
export async function generateSigningKeyPair(): Promise<KeyPair> {
    const keyPair = await crypto.subtle.generateKey(
        ECDSA_PARAMS,
        true,
        ['sign', 'verify']
    );
    return {
        publicKey: keyPair.publicKey,
        privateKey: keyPair.privateKey,
    };
}

/**
 * Export a CryptoKey to base64 string
 */
export async function exportKey(key: CryptoKey): Promise<string> {
    const format = key.type === 'public' ? 'spki' : 'pkcs8';
    const exported = await crypto.subtle.exportKey(format, key);
    return bufferToBase64(exported);
}

/**
 * Import a base64 public key string to CryptoKey
 */
export async function importPublicKey(base64: string, usage: 'ecdh' | 'ecdsa' = 'ecdh'): Promise<CryptoKey> {
    const buffer = base64ToBuffer(base64);
    const algorithm = usage === 'ecdh' ? ECDH_PARAMS : ECDSA_PARAMS;
    const keyUsages: KeyUsage[] = usage === 'ecdh' ? [] : ['verify'];

    return crypto.subtle.importKey(
        'spki',
        buffer,
        algorithm,
        true,
        keyUsages
    );
}

/**
 * Import a base64 private key to CryptoKey
 */
export async function importPrivateKey(base64: string, usage: 'ecdh' | 'ecdsa' = 'ecdh'): Promise<CryptoKey> {
    const buffer = base64ToBuffer(base64);
    const algorithm = usage === 'ecdh' ? ECDH_PARAMS : ECDSA_PARAMS;
    const keyUsages: KeyUsage[] = usage === 'ecdh' ? ['deriveBits', 'deriveKey'] : ['sign'];

    return crypto.subtle.importKey(
        'pkcs8',
        buffer,
        algorithm,
        true,
        keyUsages
    );
}

/**
 * Export a full key pair to base64 strings
 */
export async function exportKeyPair(keyPair: KeyPair): Promise<ExportedKeyPair> {
    return {
        publicKey: await exportKey(keyPair.publicKey),
        privateKey: await exportKey(keyPair.privateKey),
    };
}

// ========== X3DH Key Exchange ==========

/**
 * Sign a pre key with the identity key (ECDSA)
 */
export async function signPreKey(
    identityPrivateKey: CryptoKey,
    preKeyPublic: CryptoKey
): Promise<string> {
    // We need an ECDSA key for signing, so we generate one separately
    const preKeyData = await crypto.subtle.exportKey('spki', preKeyPublic);

    // Create a signing key
    const signingKey = await crypto.subtle.generateKey(ECDSA_PARAMS, true, ['sign', 'verify']);

    const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        signingKey.privateKey,
        preKeyData
    );

    return bufferToBase64(signature);
}

/**
 * Generate a complete Pre Key Bundle for publishing to Supabase
 */
export async function generatePreKeyBundle(
    identityKeyPair: KeyPair,
    signingKeyPair: KeyPair
): Promise<{
    bundle: PreKeyBundle;
    signedPreKeyPair: KeyPair;
    oneTimePreKeyPairs: KeyPair[];
}> {
    // Generate Signed Pre Key
    const signedPreKeyPair = await generateKeyPair();
    const signedPreKeyPub = await exportKey(signedPreKeyPair.publicKey);

    // Sign the pre key
    const preKeyData = await crypto.subtle.exportKey('spki', signedPreKeyPair.publicKey);
    const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        signingKeyPair.privateKey,
        preKeyData
    );

    // Generate One-Time Pre Keys (batch of 10)
    const oneTimePreKeyPairs: KeyPair[] = [];
    for (let i = 0; i < 10; i++) {
        oneTimePreKeyPairs.push(await generateKeyPair());
    }

    const bundle: PreKeyBundle = {
        identityKey: await exportKey(identityKeyPair.publicKey),
        signedPreKey: signedPreKeyPub,
        oneTimePreKey: await exportKey(oneTimePreKeyPairs[0].publicKey),
        signature: bufferToBase64(signature),
    };

    return { bundle, signedPreKeyPair, oneTimePreKeyPairs };
}

/**
 * X3DH: Sender side — compute shared secret from recipient's pre key bundle
 */
export async function x3dhSender(
    senderIdentityKey: KeyPair,
    recipientBundle: PreKeyBundle
): Promise<{ sharedSecret: CryptoKey; ephemeralPublicKey: string }> {
    // Generate ephemeral key
    const ephemeral = await generateKeyPair();

    // Import recipient keys
    const recipientIdentity = await importPublicKey(recipientBundle.identityKey);
    const recipientSignedPreKey = await importPublicKey(recipientBundle.signedPreKey);

    // DH1: sender_identity x recipient_signed_prekey
    const dh1 = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: recipientSignedPreKey },
        senderIdentityKey.privateKey,
        256
    );

    // DH2: sender_ephemeral x recipient_identity
    const dh2 = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: recipientIdentity },
        ephemeral.privateKey,
        256
    );

    // DH3: sender_ephemeral x recipient_signed_prekey
    const dh3 = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: recipientSignedPreKey },
        ephemeral.privateKey,
        256
    );

    // Combine DH outputs
    const combined = new Uint8Array(dh1.byteLength + dh2.byteLength + dh3.byteLength);
    combined.set(new Uint8Array(dh1), 0);
    combined.set(new Uint8Array(dh2), dh1.byteLength);
    combined.set(new Uint8Array(dh3), dh1.byteLength + dh2.byteLength);

    // Derive shared secret via HKDF
    const sharedSecret = await hkdfDerive(combined, 'PIN-X3DH-SharedSecret');

    return {
        sharedSecret,
        ephemeralPublicKey: await exportKey(ephemeral.publicKey),
    };
}

/**
 * X3DH: Receiver side — compute shared secret from sender's initial message
 */
export async function x3dhReceiver(
    receiverIdentityKey: KeyPair,
    receiverSignedPreKey: KeyPair,
    senderIdentityPub: string,
    senderEphemeralPub: string
): Promise<CryptoKey> {
    const senderIdentity = await importPublicKey(senderIdentityPub);
    const senderEphemeral = await importPublicKey(senderEphemeralPub);

    // DH1: recipient_signed_prekey x sender_identity
    const dh1 = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: senderIdentity },
        receiverSignedPreKey.privateKey,
        256
    );

    // DH2: recipient_identity x sender_ephemeral
    const dh2 = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: senderEphemeral },
        receiverIdentityKey.privateKey,
        256
    );

    // DH3: recipient_signed_prekey x sender_ephemeral
    const dh3 = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: senderEphemeral },
        receiverSignedPreKey.privateKey,
        256
    );

    const combined = new Uint8Array(dh1.byteLength + dh2.byteLength + dh3.byteLength);
    combined.set(new Uint8Array(dh1), 0);
    combined.set(new Uint8Array(dh2), dh1.byteLength);
    combined.set(new Uint8Array(dh3), dh1.byteLength + dh2.byteLength);

    return hkdfDerive(combined, 'PIN-X3DH-SharedSecret');
}

// ========== Double Ratchet ==========

/**
 * Initialize a ratchet state after X3DH
 */
export async function initRatchet(
    sharedSecret: CryptoKey,
    isInitiator: boolean
): Promise<RatchetState> {
    const ratchetKey = await generateKeyPair();

    return {
        rootKey: sharedSecret,
        sendingChainKey: null,
        receivingChainKey: null,
        sendingRatchetKey: isInitiator ? ratchetKey : null,
        receivingRatchetKey: null,
        sendCount: 0,
        receiveCount: 0,
    };
}

/**
 * Perform a DH ratchet step
 */
export async function ratchetStep(
    state: RatchetState,
    remotePublicKey?: CryptoKey
): Promise<RatchetState> {
    const newState = { ...state };

    if (remotePublicKey) {
        newState.receivingRatchetKey = remotePublicKey;

        // Derive receiving chain key
        if (newState.sendingRatchetKey) {
            const dhOutput = await crypto.subtle.deriveBits(
                { name: 'ECDH', public: remotePublicKey },
                newState.sendingRatchetKey.privateKey,
                256
            );
            const derived = await hkdfDerive(
                new Uint8Array(dhOutput),
                'PIN-Ratchet-Receiving'
            );
            newState.receivingChainKey = derived;
        }

        // Generate new sending ratchet key
        newState.sendingRatchetKey = await generateKeyPair();

        // Derive sending chain key
        const dhOutput2 = await crypto.subtle.deriveBits(
            { name: 'ECDH', public: remotePublicKey },
            newState.sendingRatchetKey.privateKey,
            256
        );
        const derived2 = await hkdfDerive(
            new Uint8Array(dhOutput2),
            'PIN-Ratchet-Sending'
        );
        newState.sendingChainKey = derived2;
    }

    return newState;
}

/**
 * Derive a message key from chain key (KDF chain)
 */
export async function deriveMessageKey(
    chainKey: CryptoKey
): Promise<{ messageKey: CryptoKey; nextChainKey: CryptoKey }> {
    const chainKeyData = await crypto.subtle.exportKey('raw', chainKey);

    // Message key = HKDF(chainKey, "msg")
    const messageKey = await hkdfDerive(
        new Uint8Array(chainKeyData),
        'PIN-MessageKey'
    );

    // Next chain key = HKDF(chainKey, "chain")
    const nextChainKey = await hkdfDerive(
        new Uint8Array(chainKeyData),
        'PIN-ChainKey'
    );

    return { messageKey, nextChainKey };
}

// ========== Encryption / Decryption ==========

/**
 * Encrypt a message using AES-GCM-256
 */
export async function encryptMessage(
    plaintext: string,
    key: CryptoKey
): Promise<{ ciphertext: string; iv: string }> {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(plaintext);
    // Copy to ArrayBuffer
    const data = new ArrayBuffer(encoded.byteLength);
    new Uint8Array(data).set(encoded);

    // Random 12-byte IV
    const ivArray = new Uint8Array(12);
    crypto.getRandomValues(ivArray);
    const iv = new ArrayBuffer(12);
    new Uint8Array(iv).set(ivArray);

    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, tagLength: 128 },
        key,
        data
    );

    return {
        ciphertext: bufferToBase64(encrypted),
        iv: bufferToBase64(iv),
    };
}

/**
 * Decrypt a message using AES-GCM-256
 */
export async function decryptMessage(
    ciphertext: string,
    iv: string,
    key: CryptoKey
): Promise<string> {
    const data = base64ToBuffer(ciphertext);
    const ivBuffer = base64ToBuffer(iv);

    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBuffer, tagLength: 128 },
        key,
        data
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
}

/**
 * Encrypt using the Double Ratchet system (full pipeline)
 */
export async function ratchetEncrypt(
    plaintext: string,
    state: RatchetState
): Promise<{ payload: EncryptedPayload; newState: RatchetState }> {
    const newState = { ...state };

    // Ensure we have a sending chain key
    let chainKey = newState.sendingChainKey;
    if (!chainKey) {
        // First message: derive from root key
        const rootKeyData = await crypto.subtle.exportKey('raw', newState.rootKey);
        chainKey = await hkdfDerive(new Uint8Array(rootKeyData), 'PIN-Initial-Send');
        newState.sendingChainKey = chainKey;
    }

    // Derive message key
    const { messageKey, nextChainKey } = await deriveMessageKey(chainKey);
    newState.sendingChainKey = nextChainKey;
    newState.sendCount++;

    // Encrypt
    const { ciphertext, iv } = await encryptMessage(plaintext, messageKey);

    // Get ratchet public key
    const ratchetPub = newState.sendingRatchetKey
        ? await exportKey(newState.sendingRatchetKey.publicKey)
        : '';

    return {
        payload: {
            ciphertext,
            iv,
            tag: '', // AES-GCM includes authentication tag in ciphertext
            ratchetPub,
            messageNumber: newState.sendCount,
        },
        newState,
    };
}

/**
 * Decrypt using the Double Ratchet system
 */
export async function ratchetDecrypt(
    payload: EncryptedPayload,
    state: RatchetState
): Promise<{ plaintext: string; newState: RatchetState }> {
    let newState = { ...state };

    // Check if we need a ratchet step (new ratchet key from sender)
    if (payload.ratchetPub) {
        const remoteKey = await importPublicKey(payload.ratchetPub);
        newState = await ratchetStep(newState, remoteKey);
    }

    // Ensure we have a receiving chain key
    let chainKey = newState.receivingChainKey;
    if (!chainKey) {
        const rootKeyData = await crypto.subtle.exportKey('raw', newState.rootKey);
        chainKey = await hkdfDerive(new Uint8Array(rootKeyData), 'PIN-Initial-Receive');
        newState.receivingChainKey = chainKey;
    }

    // Derive message key
    const { messageKey, nextChainKey } = await deriveMessageKey(chainKey);
    newState.receivingChainKey = nextChainKey;
    newState.receiveCount++;

    // Decrypt
    const plaintext = await decryptMessage(payload.ciphertext, payload.iv, messageKey);

    return { plaintext, newState };
}

// ========== Utility Functions ==========

/**
 * HKDF key derivation
 */
async function hkdfDerive(
    inputKeyMaterial: Uint8Array,
    info: string
): Promise<CryptoKey> {
    // Copy to a fresh ArrayBuffer to satisfy strict type checks
    const rawBuffer = new ArrayBuffer(inputKeyMaterial.byteLength);
    new Uint8Array(rawBuffer).set(inputKeyMaterial);

    const importedKey = await crypto.subtle.importKey(
        'raw',
        rawBuffer,
        'HKDF',
        false,
        ['deriveKey']
    );

    const encoder = new TextEncoder();
    const saltBuffer = new ArrayBuffer(32);
    const infoBuffer = encoder.encode(info);
    const infoCopy = new ArrayBuffer(infoBuffer.byteLength);
    new Uint8Array(infoCopy).set(infoBuffer);

    return crypto.subtle.deriveKey(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: saltBuffer,
            info: infoCopy,
        },
        importedKey,
        AES_PARAMS,
        true,
        ['encrypt', 'decrypt']
    );
}

/**
 * Convert ArrayBuffer to Base64 string
 */
export function bufferToBase64(buffer: ArrayBuffer | ArrayBufferLike): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Convert Base64 string to ArrayBuffer
 */
export function base64ToBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Generate a random PIN ID (8 alphanumeric characters)
 */
export function generateLocalPinId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const array = crypto.getRandomValues(new Uint8Array(8));
    let pin = '';
    for (let i = 0; i < 8; i++) {
        pin += chars[array[i] % chars.length];
    }
    return pin;
}
