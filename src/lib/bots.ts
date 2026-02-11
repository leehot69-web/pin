
import { LocalMessage } from './db';

// Definición de Bots de Prueba
export const DEMO_BOTS = [
    {
        pin: 'BOT-HELP',
        name: 'Soporte Técnico',
        avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=Support',
        responses: [
            'Hola! Soy el bot de soporte. ¿En qué puedo ayudarte?',
            'Entendido, estoy procesando tu solicitud...',
            'Por favor, reinicia la aplicación si tienes problemas.',
            'Gracias por contactar a soporte.'
        ]
    },
    {
        pin: 'BOT-SALE',
        name: 'Ventas Demo',
        avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=Sales',
        responses: [
            '¡Tenemos ofertas increíbles hoy!',
            '¿Te interesa ver nuestro catálogo?',
            'Nuestros precios son los mejores del mercado.',
            'Aceptamos pagos con QR y transferencia.'
        ]
    },
    {
        pin: 'BOT-INFO',
        name: 'Info General',
        avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=Info',
        responses: [
            'Bienvenido a PIN Chat.',
            'Esta es una versión de prueba desplegada en Vercel.',
            'Puedes probar la sincronización enviando mensajes.',
            'Todo funciona con Supabase en tiempo real.'
        ]
    }
];

// Función para obtener respuesta automática
export function getBotResponse(botPin: string, userMessage: string): string | null {
    const bot = DEMO_BOTS.find(b => b.pin === botPin);
    if (!bot) return null;

    // Lógica muy simple: respuesta aleatoria o secuencial
    const randomIndex = Math.floor(Math.random() * bot.responses.length);
    return bot.responses[randomIndex];
}

// Simular escritura y respuesta
export async function simulateBotResponse(
    botPin: string,
    userMessage: string,
    onTyping: (isTyping: boolean) => void,
    onResponse: (text: string) => void
) {
    const response = getBotResponse(botPin, userMessage);
    if (!response) return;

    // 1. Esperar un poco
    await new Promise(r => setTimeout(r, 1000));

    // 2. Empezar a "escribir"
    onTyping(true);

    // 3. Tiempo de escritura basado en longitud
    const typingTime = Math.min(3000, response.length * 50);
    await new Promise(r => setTimeout(r, typingTime));

    // 4. Enviar respuesta
    onTyping(false);
    onResponse(response);
}
