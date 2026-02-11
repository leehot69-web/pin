import { pinDb } from './db';

/**
 * Seeds demo data for the first time
 */
export async function seedDemoData(myPin: string) {
    const channels = await pinDb.getChannels();
    if (channels.length > 0) return;

    console.log('[SEED] Initializing demo bots for node:', myPin);

    const bots = [
        { id: 'BOT-HELP', name: 'SOPORTE_TECNICO', pin: 'BOT-HELP' },
        { id: 'BOT-SALE', name: 'VENTAS_AUTOMATICAS', pin: 'BOT-SALE' },
        { id: 'BOT-INFO', name: 'SISTEMA_NOTIF', pin: 'BOT-INFO' }
    ];

    for (const bot of bots) {
        const channelId = [myPin, bot.pin].sort().join('-');

        await pinDb.saveChannel({
            id: channelId,
            participantA: myPin,
            participantB: bot.pin,
            lastMessage: 'Protocolo de bienvenida activado.',
            lastMessageTime: Date.now(),
            unreadCount: 0,
            createdAt: Date.now()
        });

        await pinDb.addMessage({
            id: `welcome-${bot.id}-${Date.now()}`,
            channelId,
            bucketId: 0,
            senderPin: bot.pin,
            content: `Hola. Soy ${bot.name}. Escribe para interactuar.`,
            encryptedContent: 'ENCRIPTADO_DUMMY',
            mediaType: 'text',
            mediaUrl: null,
            expiresAt: Date.now() + 86400000,
            createdAt: Date.now(),
            status: 'delivered',
            syncedAt: Date.now()
        });
    }

    // --- PRODUCT SEEDING ---
    const productsCount = await pinDb.getProducts();
    if (productsCount.length === 0) {
        await pinDb.saveProduct({
            id: 'prod-1',
            name: 'TERMINAL_ENCRYPT_L1',
            description: 'Acceso avanzado a redes cifradas.',
            price: 499,
            imageUrl: 'https://picsum.photos/seed/tech1/400/300',
            category: 'HARDWARE',
            stock: 10,
            createdAt: Date.now()
        });
        await pinDb.saveProduct({
            id: 'prod-2',
            name: 'LICENSE_GHOST_MODE',
            description: 'Invisibilidad total en la red.',
            price: 99,
            imageUrl: 'https://picsum.photos/seed/soft1/400/300',
            category: 'SOFTWARE',
            stock: 99,
            createdAt: Date.now()
        });
    }
}

/**
 * Pre-configurador para la Demo Usuario A y Usuario B
 */
export async function setupDemoPair(myPin: string, otherPin: string) {
    console.log(`[DEMO] Setting up pair logic: ${myPin} <-> ${otherPin}`);

    const channelId = [myPin, otherPin].sort().join('-');
    const now = Date.now();

    // Solo creamos el canal si no existe
    const existing = await pinDb.getChannel(channelId);
    if (!existing) {
        await pinDb.saveChannel({
            id: channelId,
            participantA: myPin,
            participantB: otherPin,
            lastMessage: 'ESPERANDO_CONEXION_NUBE...',
            lastMessageTime: now,
            unreadCount: 0,
            createdAt: now
        });

        // NO inyectamos mensajes aquí. 
        // Queremos que el usuario escriba algo y lo vea llegar de verdad.
    }
}
