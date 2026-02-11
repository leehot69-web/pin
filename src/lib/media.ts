/**
 * PIN Media Service — Manejo de fotos, audio y cámara
 * 
 * Funcionalidades:
 * - Seleccionar imagen de galería
 * - Capturar foto con cámara
 * - Comprimir imágenes para envío eficiente
 * - Grabar notas de voz
 * - Convertir a base64 para BroadcastChannel
 */

// ========== CONSTANTES ==========

const MAX_IMAGE_WIDTH = 1200;
const MAX_IMAGE_HEIGHT = 1200;
const IMAGE_QUALITY = 0.75;
const MAX_IMAGE_SIZE_KB = 300; // Máximo 300KB comprimido

// ========== IMÁGENES ==========

/**
 * Seleccionar imagen desde la galería del dispositivo
 */
export function pickImageFromGallery(): Promise<File | null> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.style.display = 'none';

        input.onchange = () => {
            const file = input.files?.[0] || null;
            document.body.removeChild(input);
            resolve(file);
        };

        input.oncancel = () => {
            document.body.removeChild(input);
            resolve(null);
        };

        document.body.appendChild(input);
        input.click();
    });
}

/**
 * Capturar foto desde la cámara
 */
export function captureFromCamera(): Promise<File | null> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.capture = 'environment'; // Cámara trasera
        input.style.display = 'none';

        input.onchange = () => {
            const file = input.files?.[0] || null;
            document.body.removeChild(input);
            resolve(file);
        };

        input.oncancel = () => {
            document.body.removeChild(input);
            resolve(null);
        };

        document.body.appendChild(input);
        input.click();
    });
}

/**
 * Comprimir imagen manteniendo calidad aceptable
 */
export async function compressImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            const img = new Image();

            img.onload = () => {
                const canvas = document.createElement('canvas');
                let { width, height } = img;

                // Redimensionar si excede límites
                if (width > MAX_IMAGE_WIDTH || height > MAX_IMAGE_HEIGHT) {
                    const ratio = Math.min(
                        MAX_IMAGE_WIDTH / width,
                        MAX_IMAGE_HEIGHT / height
                    );
                    width = Math.round(width * ratio);
                    height = Math.round(height * ratio);
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('No se pudo crear contexto canvas'));
                    return;
                }

                // Fondo negro (para imágenes con transparencia)
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);

                // Intentar con calidad progresiva hasta cumplir tamaño
                let quality = IMAGE_QUALITY;
                let dataUrl = canvas.toDataURL('image/jpeg', quality);

                // Si excede el tamaño máximo, reducir calidad
                while (dataUrl.length > MAX_IMAGE_SIZE_KB * 1024 * 1.37 && quality > 0.3) {
                    quality -= 0.1;
                    dataUrl = canvas.toDataURL('image/jpeg', quality);
                }

                // Si aún excede, reducir resolución
                if (dataUrl.length > MAX_IMAGE_SIZE_KB * 1024 * 1.37) {
                    canvas.width = Math.round(width * 0.6);
                    canvas.height = Math.round(height * 0.6);
                    ctx.fillStyle = '#000';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    dataUrl = canvas.toDataURL('image/jpeg', 0.5);
                }

                resolve(dataUrl);
            };

            img.onerror = () => reject(new Error('Error al cargar imagen'));
            img.src = e.target?.result as string;
        };

        reader.onerror = () => reject(new Error('Error al leer archivo'));
        reader.readAsDataURL(file);
    });
}

/**
 * Obtener dimensiones de una imagen desde su data URL
 */
export function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.width, height: img.height });
        img.onerror = () => resolve({ width: 200, height: 200 });
        img.src = dataUrl;
    });
}

// ========== AUDIO ==========

export interface AudioRecording {
    blob: Blob;
    dataUrl: string;
    duration: number; // segundos
}

/**
 * Grabar nota de voz
 */
export class VoiceRecorder {
    private mediaRecorder: MediaRecorder | null = null;
    private chunks: Blob[] = [];
    private stream: MediaStream | null = null;
    private startTime = 0;
    private timerInterval: ReturnType<typeof setInterval> | null = null;

    onTimeUpdate: ((seconds: number) => void) | null = null;
    onStateChange: ((state: 'idle' | 'recording' | 'paused') => void) | null = null;

    /**
     * Iniciar grabación
     */
    async start(): Promise<boolean> {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 44100,
                },
            });

            this.mediaRecorder = new MediaRecorder(this.stream, {
                mimeType: this.getSupportedMimeType(),
            });

            this.chunks = [];

            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    this.chunks.push(e.data);
                }
            };

            this.mediaRecorder.start(100); // Chunks cada 100ms
            this.startTime = Date.now();

            // Timer visual
            this.timerInterval = setInterval(() => {
                const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
                this.onTimeUpdate?.(elapsed);
            }, 500);

            this.onStateChange?.('recording');
            return true;
        } catch (err) {
            console.error('[PIN Media] Error al acceder al micrófono:', err);
            return false;
        }
    }

    /**
     * Detener y obtener la grabación
     */
    stop(): Promise<AudioRecording> {
        return new Promise((resolve, reject) => {
            if (!this.mediaRecorder) {
                reject(new Error('No hay grabación activa'));
                return;
            }

            this.mediaRecorder.onstop = async () => {
                const duration = Math.floor((Date.now() - this.startTime) / 1000);
                const mimeType = this.getSupportedMimeType();
                const blob = new Blob(this.chunks, { type: mimeType });

                // Convertir a base64 para envío entre pestañas
                const dataUrl = await this.blobToDataUrl(blob);

                this.cleanup();
                this.onStateChange?.('idle');

                resolve({ blob, dataUrl, duration });
            };

            this.mediaRecorder.stop();
        });
    }

    /**
     * Cancelar grabación
     */
    cancel() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        this.cleanup();
        this.onStateChange?.('idle');
    }

    private cleanup() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.stream?.getTracks().forEach(t => t.stop());
        this.mediaRecorder = null;
        this.stream = null;
        this.chunks = [];
    }

    private getSupportedMimeType(): string {
        const types = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/mp4',
        ];
        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) return type;
        }
        return 'audio/webm';
    }

    private blobToDataUrl(blob: Blob): Promise<string> {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
        });
    }
}

// ========== PERMISOS ==========

export interface PermissionStatus {
    camera: 'granted' | 'denied' | 'prompt';
    microphone: 'granted' | 'denied' | 'prompt';
    notifications: 'granted' | 'denied' | 'default';
}

/**
 * Verificar estado de permisos del dispositivo
 */
export async function checkPermissions(): Promise<PermissionStatus> {
    const result: PermissionStatus = {
        camera: 'prompt',
        microphone: 'prompt',
        notifications: 'default',
    };

    try {
        if (navigator.permissions) {
            const [cam, mic] = await Promise.all([
                navigator.permissions.query({ name: 'camera' as PermissionName }),
                navigator.permissions.query({ name: 'microphone' as PermissionName }),
            ]);
            result.camera = cam.state as 'granted' | 'denied' | 'prompt';
            result.microphone = mic.state as 'granted' | 'denied' | 'prompt';
        }
    } catch {
        // Algunos navegadores no soportan permissions.query para camera/microphone
    }

    if ('Notification' in window) {
        result.notifications = Notification.permission;
    }

    return result;
}

/**
 * Solicitar permiso de notificaciones
 */
export async function requestNotificationPermission(): Promise<boolean> {
    if (!('Notification' in window)) return false;

    const result = await Notification.requestPermission();
    return result === 'granted';
}

/**
 * Formatear duración de audio mm:ss
 */
export function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}
