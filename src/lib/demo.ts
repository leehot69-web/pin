/**
 * PIN Demo Mode — Dos usuarios para probar entre pestañas
 * 
 * Usuario 1: ALICE01X — Pestaña 1
 * Usuario 2: BOB002YZ — Pestaña 2
 */

import { pinDb, type LocalChannel, type LocalKeyStore } from '@/lib/db';

// ========== Los 2 Usuarios para Demo ==========

export const DEMO_USER_A = { pin: 'ALICE01X', name: 'Alice' };
export const DEMO_USER_B = { pin: 'BOB002YZ', name: 'Bob' };

export const DEMO_USERS = [DEMO_USER_A, DEMO_USER_B];

// ID del canal entre ellos (siempre el mismo, determinístico)
export const DEMO_CHANNEL_ID = 'ch-alice-bob-demo';

/**
 * Inicializar datos demo para un usuario específico
 */
export async function seedDemoForUser(pin: string): Promise<void> {
    await pinDb.init();

    // Guardar llaves del usuario
    const keyStore: LocalKeyStore = {
        pin,
        identityKeyPub: `demo-pub-${pin}`,
        identityKeyPriv: `demo-priv-${pin}`,
        signedPreKeyPub: `demo-spk-pub-${pin}`,
        signedPreKeyPriv: `demo-spk-priv-${pin}`,
        signingKeyPub: `demo-sig-pub-${pin}`,
        signingKeyPriv: `demo-sig-priv-${pin}`,
        oneTimePreKeys: '[]',
    };
    await pinDb.saveKeys(keyStore);

    // Crear el canal entre Alice y Bob
    const [pinA, pinB] = [DEMO_USER_A.pin, DEMO_USER_B.pin].sort();
    const channel: LocalChannel = {
        id: DEMO_CHANNEL_ID,
        participantA: pinA,
        participantB: pinB,
        lastMessage: '¡Canal seguro creado! 🔐',
        lastMessageTime: Date.now(),
        unreadCount: 0,
        createdAt: Date.now(),
    };
    await pinDb.saveChannel(channel);

    console.log(`[PIN Demo] Datos creados para ${pin}`);
}

/**
 * Verificar si ya hay datos para un usuario
 */
export async function isDemoSeeded(pin: string): Promise<boolean> {
    await pinDb.init();
    const keys = await pinDb.getKeys(pin);
    return !!keys;
}

/**
 * Obtener nombre de un PIN demo
 */
export function getDemoName(pin: string): string | null {
    const user = DEMO_USERS.find(u => u.pin === pin);
    return user ? user.name : null;
}
