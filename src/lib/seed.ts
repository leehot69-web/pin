
import { pinDb, LocalProduct, LocalChannel, LocalMessage, calculateBucketId } from './db';

// Datos de Prueba
const DEMO_PRODUCTS: LocalProduct[] = [
    {
        id: 'prod-1',
        name: 'Camisa PIN Retro',
        price: '25.00',
        imageUrl: 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=400',
        sellerPin: 'current-user', // Se reemplazará con el PIN real
        category: 'Ropa',
        createdAt: Date.now()
    },
    {
        id: 'prod-2',
        name: 'Auriculares Black',
        price: '89.99',
        imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400',
        sellerPin: 'current-user',
        category: 'Tecnología',
        createdAt: Date.now()
    },
    {
        id: 'prod-3',
        name: 'Taza Minimalista',
        price: '12.50',
        imageUrl: 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=400',
        sellerPin: 'current-user',
        category: 'Hogar',
        createdAt: Date.now()
    }
];

export async function seedDemoData(userPin: string) {
    // 1. Verificar si ya hay productos
    const existingProducts = await pinDb.getProducts();
    if (existingProducts.length === 0) {
        console.log('[SEED] Insertando productos de prueba...');
        for (const prod of DEMO_PRODUCTS) {
            await pinDb.saveProduct({ ...prod, sellerPin: userPin });
        }
    }

    // 2. Verificar si ya hay chats
    const existingChannels = await pinDb.getChannels();
    const demoBotPins = ['BOT-HELP', 'BOT-SALE', 'BOT-INFO'];
    const botNames = ['Soporte Técnico', 'Ventas Demo', 'Info General'];

    // Crear chats con bots si no existen
    for (let i = 0; i < demoBotPins.length; i++) {
        const botPin = demoBotPins[i];
        const channelId = [userPin, botPin].sort().join('-'); // Deterministic ID

        const exists = existingChannels.find(c => c.id === channelId);
        if (!exists) {
            console.log(`[SEED] Creando chat con bot ${botNames[i]}`);

            // Crear Canal
            await pinDb.saveChannel({
                id: channelId,
                participantA: userPin,
                participantB: botPin,
                lastMessage: 'Bienvenido! Escribe algo para probar.',
                lastMessageTime: Date.now(),
                unreadCount: 1,
                createdAt: Date.now()
            });

            // Crear Mensaje de Bienvenida
            const msgId = `msg-welcome-${botPin}`;
            await pinDb.addMessage({
                id: msgId,
                channelId,
                bucketId: calculateBucketId(),
                senderPin: botPin,
                content: `Hola! Soy ${botNames[i]}. Escribe algo para probar la respuesta automática.`,
                encryptedContent: 'Hola! Soy un bot.',
                mediaType: 'text',
                mediaUrl: null,
                expiresAt: Date.now() + 86400000,
                createdAt: Date.now(),
                status: 'delivered',
                syncedAt: Date.now()
            });
        }
    }
}
