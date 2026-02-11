/**
 * PIN CrossTab — Comunicación en tiempo real entre pestañas
 * 
 * Usa BroadcastChannel API para simular mensajería
 * entre dos pestañas del navegador sin necesitar backend.
 */

export interface CrossTabMessage {
    type: 'message' | 'typing' | 'delivered' | 'online';
    channelId: string;
    senderPin: string;
    payload: {
        id?: string;
        content?: string;
        encryptedContent?: string;
        createdAt?: number;
        expiresAt?: number;
        mediaType?: string;
        mediaUrl?: string;
        isTyping?: boolean;
    };
}

type MessageHandler = (msg: CrossTabMessage) => void;

class CrossTabService {
    private channel: BroadcastChannel | null = null;
    private handlers: Set<MessageHandler> = new Set();
    private myPin: string | null = null;

    /**
     * Inicializar el canal de comunicación entre pestañas
     */
    init(pin: string) {
        this.myPin = pin;

        // Cerrar canal anterior si existe
        if (this.channel) {
            this.channel.close();
        }

        // Crear canal compartido "pin-crosstab"
        this.channel = new BroadcastChannel('pin-crosstab');

        this.channel.onmessage = (event: MessageEvent<CrossTabMessage>) => {
            const msg = event.data;

            // Ignorar mensajes propios
            if (msg.senderPin === this.myPin) return;

            // Notificar a todos los handlers
            this.handlers.forEach(handler => handler(msg));
        };

        // Anunciar que estamos online
        this.broadcast({
            type: 'online',
            channelId: '',
            senderPin: pin,
            payload: {},
        });

        console.log(`[PIN CrossTab] Inicializado para ${pin}`);
    }

    /**
     * Enviar un mensaje a las otras pestañas
     */
    broadcast(msg: CrossTabMessage) {
        if (!this.channel) {
            console.warn('[PIN CrossTab] Canal no inicializado');
            return;
        }
        this.channel.postMessage(msg);
    }

    /**
     * Enviar un mensaje de chat
     */
    sendMessage(channelId: string, content: string, msgId: string) {
        if (!this.myPin) return;

        const now = Date.now();
        this.broadcast({
            type: 'message',
            channelId,
            senderPin: this.myPin,
            payload: {
                id: msgId,
                content,
                createdAt: now,
                expiresAt: now + (8 * 60 * 60 * 1000),
                mediaType: 'text',
            },
        });
    }

    /**
     * Enviar indicador de "escribiendo..."
     */
    sendTyping(channelId: string, isTyping: boolean) {
        if (!this.myPin) return;
        this.broadcast({
            type: 'typing',
            channelId,
            senderPin: this.myPin,
            payload: { isTyping },
        });
    }

    /**
     * Confirmar entrega de mensaje
     */
    sendDelivered(channelId: string, msgId: string) {
        if (!this.myPin) return;
        this.broadcast({
            type: 'delivered',
            channelId,
            senderPin: this.myPin,
            payload: { id: msgId },
        });
    }

    /**
     * Registrar un handler para recibir mensajes
     */
    onMessage(handler: MessageHandler): () => void {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
    }

    /**
     * Limpiar
     */
    destroy() {
        this.channel?.close();
        this.channel = null;
        this.handlers.clear();
        this.myPin = null;
    }
}

// Singleton
export const crossTab = new CrossTabService();
