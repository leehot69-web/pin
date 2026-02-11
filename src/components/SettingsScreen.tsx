/**
 * SettingsScreen — Ajustes completos para PIN
 * 
 * Secciones:
 * - Perfil (PIN, alias)
 * - Privacidad & Seguridad
 * - Notificaciones
 * - Almacenamiento
 * - Permisos del dispositivo
 * - Sobre PIN
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { usePinStore } from '@/store/pinStore';
import { pinDb, type LocalProduct } from '@/lib/db';
import { checkPermissions, requestNotificationPermission, type PermissionStatus } from '@/lib/media';

type SettingsSection = 'main' | 'profile' | 'privacy' | 'notifications' | 'storage' | 'permissions' | 'catalog' | 'about';

interface AutoLockOption {
    label: string;
    value: number; // minutos, 0 = nunca
}

const AUTO_LOCK_OPTIONS: AutoLockOption[] = [
    { label: '1 MiN', value: 1 },
    { label: '5 MIN', value: 5 },
    { label: '15 MIN', value: 15 },
    { label: '30 MIN', value: 30 },
    { label: 'NUNCA', value: 0 },
];

interface ExpireOption {
    label: string;
    value: number; // horas
}

const EXPIRE_OPTIONS: ExpireOption[] = [
    { label: '1 HORA', value: 1 },
    { label: '8 HORAS', value: 8 },
    { label: '24 HORAS', value: 24 },
    { label: '7 DÍAS', value: 168 },
    { label: 'NUNCA', value: 0 },
];

export default function SettingsScreen() {
    const { identity, setCurrentScreen, setIdentity } = usePinStore();
    const [section, setSection] = useState<SettingsSection>('main');
    const [permissions, setPermissions] = useState<PermissionStatus | null>(null);

    // Settings state (persistido en localStorage)
    const [alias, setAlias] = useState(() => localStorage.getItem('pin-alias') || '');
    const [autoLock, setAutoLock] = useState(() => parseInt(localStorage.getItem('pin-auto-lock') || '5'));
    const [messageExpire, setMessageExpire] = useState(() => parseInt(localStorage.getItem('pin-msg-expire') || '8'));
    const [notificationsEnabled, setNotificationsEnabled] = useState(() => localStorage.getItem('pin-notifications') !== 'false');
    const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('pin-sound') !== 'false');
    const [vibrationEnabled, setVibrationEnabled] = useState(() => localStorage.getItem('pin-vibration') !== 'false');

    // Storage info
    const [storageInfo, setStorageInfo] = useState<{ messages: number; channels: number; estimatedKB: number } | null>(null);

    // Catalog state
    const [products, setProducts] = useState<LocalProduct[]>([]);
    const [isAddingProduct, setIsAddingProduct] = useState(false);
    const [isSyncingShopify, setIsSyncingShopify] = useState(false);
    const [shopifyDomain, setShopifyDomain] = useState('');
    const [newProduct, setNewProduct] = useState<Partial<LocalProduct>>({
        id: '',
        name: '',
        price: '',
        imageUrl: ''
    });

    // Load permissions
    useEffect(() => {
        checkPermissions().then(setPermissions);
    }, []);

    // Load storage info
    useEffect(() => {
        if (section === 'storage') {
            loadStorageInfo();
        }
    }, [section]);

    const loadStorageInfo = async () => {
        try {
            const channels = await pinDb.getChannels();
            // Estimate storage
            let messageCount = 0;
            for (const ch of channels) {
                const msgs = await pinDb.getMessagesByChannel(ch.id);
                messageCount += msgs.length;
            }
            const estimatedKB = Math.round(messageCount * 0.5); // ~0.5KB per text message estimate
            setStorageInfo({ messages: messageCount, channels: channels.length, estimatedKB });
        } catch {
            setStorageInfo({ messages: 0, channels: 0, estimatedKB: 0 });
        }
    };

    // Save settings
    const saveSetting = (key: string, value: string) => {
        localStorage.setItem(key, value);
    };

    const handleSetAlias = (val: string) => {
        setAlias(val);
        saveSetting('pin-alias', val);
    };

    const handleSetAutoLock = (val: number) => {
        setAutoLock(val);
        saveSetting('pin-auto-lock', val.toString());
    };

    const handleSetExpire = (val: number) => {
        setMessageExpire(val);
        saveSetting('pin-msg-expire', val.toString());
    };

    const handleToggleNotifications = async () => {
        if (!notificationsEnabled) {
            const granted = await requestNotificationPermission();
            if (!granted) return;
        }
        const newVal = !notificationsEnabled;
        setNotificationsEnabled(newVal);
        saveSetting('pin-notifications', newVal.toString());
    };

    const handleToggleSound = () => {
        const newVal = !soundEnabled;
        setSoundEnabled(newVal);
        saveSetting('pin-sound', newVal.toString());
    };

    const handleToggleVibration = () => {
        const newVal = !vibrationEnabled;
        setVibrationEnabled(newVal);
        saveSetting('pin-vibration', newVal.toString());
    };

    const handleCopyPin = () => {
        if (identity?.pin) {
            navigator.clipboard.writeText(identity.pin);
            alert('PIN copiado al portapapeles');
        }
    };

    const loadProducts = async () => {
        const list = await pinDb.getProducts();
        setProducts(list);
    };

    const handleSaveProduct = async () => {
        if (!newProduct.id || !newProduct.name || !newProduct.price || !newProduct.imageUrl) {
            alert('PROTOCOL_ERROR: Faltan campos obligatorios');
            return;
        }

        const product: LocalProduct = {
            id: newProduct.id,
            name: newProduct.name,
            price: newProduct.price,
            imageUrl: newProduct.imageUrl,
            sellerPin: identity?.pin || 'MY_STORE',
            createdAt: Date.now()
        };

        await pinDb.saveProduct(product);
        setIsAddingProduct(false);
        setNewProduct({ id: '', name: '', price: '', imageUrl: '' });
        loadProducts();
    };

    const handleDeleteProduct = async (id: string) => {
        if (!confirm('¿ELIMINAR_ESTE_ASSET?')) return;
        await pinDb.deleteProduct(id);
        loadProducts();
    };

    const handleShopifySync = async () => {
        if (!shopifyDomain) {
            alert('PROTOCOL_ERROR: Introduce un dominio de Shopify');
            return;
        }

        // Limpiar el dominio (quitar https:// si lo ponen)
        let domain = shopifyDomain.replace('https://', '').replace('http://', '').split('/')[0];
        if (!domain.includes('myshopify.com')) {
            alert('ADVERTENCIA: Asegúrate de usar el subdominio .myshopify.com');
        }

        setIsSyncingShopify(true);
        try {
            const response = await fetch(`https://${domain}/products.json`);
            if (!response.ok) throw new Error('FETCH_FAILED');

            const data = await response.json();
            const shopifyProducts = data.products || [];

            for (const sp of shopifyProducts) {
                const product: LocalProduct = {
                    id: `SHPF-${sp.id}`,
                    name: sp.title,
                    price: sp.variants[0]?.price || '0.00',
                    imageUrl: sp.images[0]?.src || '',
                    sellerPin: identity?.pin || 'MY_STORE',
                    createdAt: Date.now()
                };
                if (product.imageUrl) {
                    await pinDb.saveProduct(product);
                }
            }

            alert(`SINCRONIZACION_EXITOSA: ${shopifyProducts.length} assets inyectados.`);
            setShopifyDomain('');
            loadProducts();
        } catch (err) {
            console.error(err);
            alert('SYNC_ERROR: No se pudo acceder a los metadatos de la tienda.');
        } finally {
            setIsSyncingShopify(false);
        }
    };

    // Load catalog info
    useEffect(() => {
        if (section === 'catalog') {
            loadProducts();
        }
    }, [section]);

    const handleClearAllMessages = async () => {
        if (!confirm('¿Seguro? Se borrarán TODOS los mensajes locales. Esta acción no se puede deshacer.')) return;
        try {
            await pinDb.clearAllMessages();
            alert('Todos los mensajes han sido eliminados');
        } catch {
            alert('Error al borrar mensajes');
        }
    };

    const handleDeleteIdentity = async () => {
        if (!confirm('⚠️ PELIGRO: Se borrará tu identidad completa, claves de cifrado y todos los datos. NO podrás recuperar tu PIN. ¿Continuar?')) return;
        if (!confirm('¿ESTÁS COMPLETAMENTE SEGURO? Escribe tu PIN mentalmente para confirmar.')) return;

        try {
            await pinDb.clearAll();
            localStorage.clear();
            setIdentity(null);
            setCurrentScreen('vault');
        } catch {
            alert('Error al eliminar identidad');
        }
    };

    const handleBack = () => {
        if (section !== 'main') {
            setSection('main');
        } else {
            setCurrentScreen('chats');
        }
    };

    // ========== RENDER SECCIONES ==========

    const renderSection = () => {
        switch (section) {
            case 'profile': return renderProfile();
            case 'privacy': return renderPrivacy();
            case 'notifications': return renderNotifications();
            case 'storage': return renderStorage();
            case 'permissions': return renderPermissions();
            case 'catalog': return renderCatalog();
            case 'about': return renderAbout();
            default: return renderMain();
        }
    };

    const getSectionTitle = (): string => {
        switch (section) {
            case 'profile': return 'PERFIL';
            case 'privacy': return 'PRIVACIDAD';
            case 'notifications': return 'NOTIFICACIONES';
            case 'storage': return 'ALMACENAMIENTO';
            case 'permissions': return 'PERMISOS';
            case 'catalog': return 'MI CATALOGO';
            case 'about': return 'SOBRE PIN';
            default: return 'AJUSTES';
        }
    };

    // ---- Sección Principal ----
    // ---- Sección Principal (Dashboard de Opciones) ----
    const renderMain = () => (
        <div className="settings-list">
            {/* Tarjeta de Identidad */}
            <div className="settings-identity-card">
                <div style={{ width: 56, height: 56, border: '0.5px solid rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, color: '#fff' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 32 }}>account_circle</span>
                </div>
                <div className="settings-identity-info">
                    <div className="settings-pin-display" style={{ fontSize: 24, fontWeight: 300, letterSpacing: 4 }}>{identity?.pin || '--------'}</div>
                    <div className="vault-subtitle" style={{ fontSize: 9, opacity: 0.5 }}>
                        {alias || 'SISTEMA_SIN_ALIAS'}
                    </div>
                </div>
            </div>

            {/* Grupo: Seguridad y Privacidad */}
            <div className="settings-group">
                <div className="settings-group-label" style={{ opacity: 0.3, marginBottom: 12 }}>SEGURIDAD_Y_IDENTIDAD</div>
                <button className="settings-item" onClick={() => setSection('profile')}>
                    <span className="material-symbols-outlined" style={{ fontSize: 22 }}>fingerprint</span>
                    <span className="settings-item-label" style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>_PERFIL_DE_IDENTIDAD</span>
                    <span className="material-symbols-outlined" style={{ opacity: 0.2 }}>chevron_right</span>
                </button>
                <button className="settings-item" onClick={() => setSection('privacy')}>
                    <span className="material-symbols-outlined" style={{ fontSize: 22 }}>security</span>
                    <span className="settings-item-label" style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>_PROTOCOLOS_DE_PRIVACIDAD</span>
                    <span className="material-symbols-outlined" style={{ opacity: 0.2 }}>chevron_right</span>
                </button>
            </div>

            {/* Grupo: Backup (NUEVO) */}
            <div className="settings-group">
                <div className="settings-group-label" style={{ opacity: 0.3, marginBottom: 12 }}>BACKUP_DE_ESTADO</div>
                <button className="settings-item" onClick={() => alert('EXPORTANDO_LLAVES_E2EE...\nPrepara tu dispositivo para guardar el archivo backup.json')}>
                    <span className="material-symbols-outlined" style={{ fontSize: 22 }}>cloud_upload</span>
                    <div className="flex-1">
                        <span className="settings-item-label" style={{ fontFamily: 'var(--font-mono)', fontSize: 13, display: 'block' }}>_EXPORTAR_IDENTIDAD</span>
                        <span className="vault-subtitle" style={{ fontSize: 7, opacity: 0.4 }}>RESPALDO_DE_LLAVES_PRIVADAS</span>
                    </div>
                </button>
                <button className="settings-item" onClick={() => alert('IMPORTAR_PROTOCOLO...\nSelecciona tu archivo de respaldo.')}>
                    <span className="material-symbols-outlined" style={{ fontSize: 22 }}>cloud_download</span>
                    <span className="settings-item-label" style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>_IMPORTAR_RECUPERACION</span>
                </button>
            </div>

            {/* Grupo: Mi Catálogo (Tienda) */}
            <div className="settings-group">
                <div className="settings-group-label" style={{ opacity: 0.3, marginBottom: 12 }}>NEGOCIO_Y_COMERCIO</div>
                <button className="settings-item" onClick={() => setSection('catalog')}>
                    <span className="material-symbols-outlined" style={{ fontSize: 22, color: '#FFD700' }}>storefront</span>
                    <div className="flex-1">
                        <span className="settings-item-label" style={{ fontFamily: 'var(--font-mono)', fontSize: 13, display: 'block' }}>_GESTIONAR_MI_TIENDA</span>
                        <span className="vault-subtitle" style={{ fontSize: 7, opacity: 0.4 }}>INYECCION_DE_METADATOS_SHOP</span>
                    </div>
                    <span className="material-symbols-outlined" style={{ opacity: 0.2 }}>chevron_right</span>
                </button>
            </div>

            {/* Grupo: Sistema */}
            <div className="settings-group">
                <div className="settings-group-label" style={{ opacity: 0.3, marginBottom: 12 }}>SISTEMA_Y_DATOS</div>
                <button className="settings-item" onClick={() => setSection('storage')}>
                    <span className="material-symbols-outlined" style={{ fontSize: 22 }}>database</span>
                    <span className="settings-item-label" style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>_ALMACENAMIENTO_LOCAL</span>
                    <span className="material-symbols-outlined" style={{ opacity: 0.2 }}>chevron_right</span>
                </button>
                <button className="settings-item" onClick={() => setSection('permissions')}>
                    <span className="material-symbols-outlined" style={{ fontSize: 22 }}>settings_input_component</span>
                    <span className="settings-item-label" style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>_RECURSOS_HARDWARE</span>
                    <span className="material-symbols-outlined" style={{ opacity: 0.2 }}>chevron_right</span>
                </button>
                <button className="settings-item" onClick={() => setSection('about')}>
                    <span className="material-symbols-outlined" style={{ fontSize: 22 }}>info</span>
                    <span className="settings-item-label" style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>_ESPECIFICACIONES_V4.2</span>
                </button>
            </div>

            <div className="settings-group" style={{ marginTop: 40, paddingBottom: 60 }}>
                <button
                    className="settings-danger-btn"
                    onClick={() => setCurrentScreen('vault')}
                    style={{ background: 'transparent', color: '#fff', border: '1.5px solid #fff', borderRadius: 0, padding: '16px', letterSpacing: 2 }}
                >
                    _CERRAR_BOVEDA_ACTUAL
                </button>
                <div style={{ height: 12 }} />
                <button className="settings-danger-btn" onClick={handleDeleteIdentity} style={{ opacity: 0.4, fontSize: 9 }}>
                    _AUTODESTRUCCION_DE_DATOS
                </button>
            </div>
        </div>
    );

    // ---- Perfil ----
    const renderProfile = () => (
        <div className="settings-list">
            <div className="settings-group">
                <div className="settings-group-label">PIN_DE_IDENTIDAD_SEGURO</div>
                <div className="flex items-center justify-between border border-white/20 p-4 mb-4">
                    <span className="settings-info-value mono" style={{ fontSize: 20 }}>{identity?.pin || '--------'}</span>
                    <button className="vault-btn" onClick={handleCopyPin} style={{ width: 'auto', padding: '8px 16px', fontSize: 10 }}>COPIAR_ID</button>
                </div>
                <div className="vault-subtitle" style={{ fontSize: 8, opacity: 0.4, lineHeight: 1.6 }}>
                    COMPARTE ESTE IDENTIFICADOR CON NODOS DE CONFIANZA PARA ESTABLECER CANALES E2EE.
                </div>
            </div>

            <div className="settings-group">
                <div className="settings-group-label">ALIAS_DEL_IDENTIFICADOR</div>
                <input
                    type="text"
                    className="w-full bg-black border border-white/20 p-4 font-mono text-sm focus:border-white outline-none"
                    value={alias}
                    onChange={(e) => handleSetAlias(e.target.value)}
                    placeholder="INTRODUCIR_ALIAS_LOCAL..."
                    maxLength={20}
                    style={{ borderRadius: 0 }}
                />
                <div className="vault-subtitle" style={{ fontSize: 8, opacity: 0.4, marginTop: 12 }}>
                    SOLO ALIAS LOCAL. NO SERA VISIBLE PARA NODOS EXTERNOS.
                </div>
            </div>

            <div className="settings-group">
                <div className="settings-group-label">LLAVE_DE_IDENTIDAD_PUBLICA</div>
                <div className="bg-white/5 p-4 border border-white/10 font-mono text-[10px] break-all opacity-60">
                    {identity?.identityKeyPub || 'NULO'}
                </div>
                <div className="vault-subtitle" style={{ fontSize: 8, opacity: 0.4, marginTop: 12 }}>
                    PAQUETE_PREKEY_X3DH_SIGNAL_PROTOCOL.
                </div>
            </div>
        </div>
    );

    // ---- Privacidad ----
    const renderPrivacy = () => (
        <div className="settings-list">
            <div className="settings-group">
                <div className="settings-group-label">PROTOCOLO_BLOQUEO_AUTOMATICO</div>
                <div className="grid grid-cols-2 gap-2">
                    {AUTO_LOCK_OPTIONS.map((opt) => (
                        <button
                            key={opt.value}
                            className={`vault-btn ${autoLock === opt.value ? 'primary' : ''}`}
                            onClick={() => handleSetAutoLock(opt.value)}
                            style={{ fontSize: 10 }}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="settings-group">
                <div className="settings-group-label">CADUCIDAD_GLOBAL_DE_MENSAJES</div>
                <div className="grid grid-cols-2 gap-2">
                    {EXPIRE_OPTIONS.map((opt) => (
                        <button
                            key={opt.value}
                            className={`vault-btn ${messageExpire === opt.value ? 'primary' : ''}`}
                            onClick={() => handleSetExpire(opt.value)}
                            style={{ fontSize: 10 }}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
                <div className="vault-subtitle" style={{ fontSize: 8, opacity: 0.4, marginTop: 12 }}>
                    ESTA CONFIGURACION SE APLICA A TODOS LOS CHATS POR DEFECTO.
                </div>
            </div>

            <div className="settings-group" style={{ marginTop: 40 }}>
                <div className="settings-group-label" style={{ color: '#ff4444' }}>ACCIONES_DE_AUTODESTRUCCION</div>
                <button className="vault-btn" onClick={handleClearAllMessages} style={{ borderColor: 'rgba(255,68,68,0.3)', color: '#ff4444', marginBottom: 12 }}>
                    _limpiar_buffer_local
                </button>
                <button className="vault-btn primary" onClick={handleDeleteIdentity} style={{ background: '#ff4444', border: 'none' }}>
                    _terminar_nodo_de_identidad
                </button>
            </div>
        </div>
    );

    // ---- Notificaciones ----
    const renderNotifications = () => (
        <div className="settings-list">
            <div className="settings-group">
                <button
                    className="flex justify-between items-center w-full py-6 border-b border-white/10"
                    onClick={handleToggleNotifications}
                >
                    <span className="vault-subtitle" style={{ fontSize: 11, color: '#fff' }}>SIGNAL_ALERTS</span>
                    <span className={`material-symbols-outlined ${notificationsEnabled ? 'text-white' : 'text-white/20'}`} style={{ fontSize: 32 }}>
                        {notificationsEnabled ? 'toggle_on' : 'toggle_off'}
                    </span>
                </button>
                <button
                    className="flex justify-between items-center w-full py-6 border-b border-white/10"
                    onClick={handleToggleSound}
                >
                    <span className="vault-subtitle" style={{ fontSize: 11, color: '#fff' }}>AUDIBLE_RECEPTION</span>
                    <span className={`material-symbols-outlined ${soundEnabled ? 'text-white' : 'text-white/20'}`} style={{ fontSize: 32 }}>
                        {soundEnabled ? 'toggle_on' : 'toggle_off'}
                    </span>
                </button>
                <button
                    className="flex justify-between items-center w-full py-6 border-b border-white/10"
                    onClick={handleToggleVibration}
                >
                    <span className="vault-subtitle" style={{ fontSize: 11, color: '#fff' }}>HAPTIC_FEEDBACK</span>
                    <span className={`material-symbols-outlined ${vibrationEnabled ? 'text-white' : 'text-white/20'}`} style={{ fontSize: 32 }}>
                        {vibrationEnabled ? 'toggle_on' : 'toggle_off'}
                    </span>
                </button>
            </div>
        </div>
    );

    // ---- Almacenamiento ----
    const renderStorage = () => (
        <div className="settings-list">
            <div className="settings-group">
                <div className="settings-group-label">IDB_BUFFER_STATUS</div>
                {storageInfo ? (
                    <div className="grid grid-cols-3 gap-1 border border-white/20">
                        <div className="p-4 border-r border-white/20 flex flex-col items-center">
                            <span className="font-mono text-xl">{storageInfo.messages}</span>
                            <span className="vault-subtitle" style={{ fontSize: 7, opacity: 0.4 }}>_payloads</span>
                        </div>
                        <div className="p-4 border-r border-white/20 flex flex-col items-center">
                            <span className="font-mono text-xl">{storageInfo.channels}</span>
                            <span className="vault-subtitle" style={{ fontSize: 7, opacity: 0.4 }}>_nodes</span>
                        </div>
                        <div className="p-4 flex flex-col items-center">
                            <span className="font-mono text-xl">{storageInfo.estimatedKB}KB</span>
                            <span className="vault-subtitle" style={{ fontSize: 7, opacity: 0.4 }}>_weight</span>
                        </div>
                    </div>
                ) : (
                    <div className="vault-subtitle" style={{ fontSize: 10, opacity: 0.3 }}>_calculando_peso_del_buffer...</div>
                )}
            </div>

            <div className="settings-group" style={{ marginTop: 40 }}>
                <button className="vault-btn" onClick={handleClearAllMessages}>
                    _limpiar_buffer_de_mensajes
                </button>
                <div className="vault-subtitle" style={{ fontSize: 8, opacity: 0.4, marginTop: 12 }}>
                    LAS_LLAVES_DE_IDENTIDAD_SERAN_CONSERVADAS.
                </div>
            </div>
        </div>
    );

    // ---- Permisos ----
    const renderPermissions = () => (
        <div className="settings-list">
            <div className="settings-group">
                <div className="settings-group-label">ESTADO_PERMISOS_HARDWARE</div>

                <div className="flex items-center justify-between py-4 border-b border-white/10">
                    <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined" style={{ fontSize: 18, opacity: 0.4 }}>camera_alt</span>
                        <span className="vault-subtitle" style={{ fontSize: 11, color: '#fff' }}>MODULO_CAMARA</span>
                    </div>
                    <span className="vault-subtitle" style={{ fontSize: 8, padding: '2px 8px', border: '0.5px solid white', opacity: permissions?.camera === 'granted' ? 1 : 0.3 }}>
                        {permissions?.camera?.toUpperCase() === 'GRANTED' ? 'CONCEDIDO' : permissions?.camera?.toUpperCase() || 'NULO'}
                    </span>
                </div>

                <div className="flex items-center justify-between py-4 border-b border-white/10">
                    <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined" style={{ fontSize: 18, opacity: 0.4 }}>mic</span>
                        <span className="vault-subtitle" style={{ fontSize: 11, color: '#fff' }}>MODULO_MICROFONO</span>
                    </div>
                    <span className="vault-subtitle" style={{ fontSize: 8, padding: '2px 8px', border: '0.5px solid white', opacity: permissions?.microphone === 'granted' ? 1 : 0.3 }}>
                        {permissions?.microphone?.toUpperCase() === 'GRANTED' ? 'CONCEDIDO' : permissions?.microphone?.toUpperCase() || 'NULO'}
                    </span>
                </div>

                <div className="flex items-center justify-between py-4 border-b border-white/10">
                    <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined" style={{ fontSize: 18, opacity: 0.4 }}>notifications</span>
                        <span className="vault-subtitle" style={{ fontSize: 11, color: '#fff' }}>SISTEMA_DE_ALERTAS</span>
                    </div>
                    <span className="vault-subtitle" style={{ fontSize: 8, padding: '2px 8px', border: '0.5px solid white', opacity: permissions?.notifications === 'granted' ? 1 : 0.3 }}>
                        {permissions?.notifications?.toUpperCase() === 'GRANTED' ? 'CONCEDIDO' : permissions?.notifications?.toUpperCase() || 'NULO'}
                    </span>
                </div>
            </div>
        </div>
    );

    // ---- Sobre PIN ----
    const renderAbout = () => (
        <div className="settings-list">
            <div className="flex flex-col items-center py-12 border-b border-white/10">
                <h1 className="vault-title" style={{ fontSize: 32, letterSpacing: -1 }}>PIN</h1>
                <span className="vault-subtitle" style={{ fontSize: 9, opacity: 0.4 }}>ESTACION_NODO_ENCRIPTADO_v4.2</span>
            </div>

            <div className="settings-group">
                <div className="settings-group-label">ESPECIFICACIONES_DE_CIFRADO</div>
                <div className="bg-white/5 p-4 flex flex-col gap-2">
                    <div className="flex justify-between font-mono text-[9px] uppercase"><span style={{ opacity: 0.4 }}>Sistema:</span> <span>Signal (Double Ratchet)</span></div>
                    <div className="flex justify-between font-mono text-[9px] uppercase"><span style={{ opacity: 0.4 }}>Cifrado:</span> <span>AES-256-GCM</span></div>
                    <div className="flex justify-between font-mono text-[9px] uppercase"><span style={{ opacity: 0.4 }}>Curva:</span> <span>Curve25519</span></div>
                    <div className="flex justify-between font-mono text-[9px] uppercase"><span style={{ opacity: 0.4 }}>KDF:</span> <span>HKDF-SHA256</span></div>
                </div>
            </div>

            <p className="vault-subtitle" style={{ fontSize: 8, opacity: 0.3, textAlign: 'center', marginTop: 40, lineHeight: 1.6 }}>
                _terminal_de_transmision_segura_v4.2_alpha<br />
                DESARROLLADO_BAJO_ARQUITECTURA_ZERO_KNOWLEDGE.
            </p>
        </div>
    );

    const renderCatalog = () => (
        <div className="settings-list" style={{ paddingBottom: 100 }}>
            <div className="encryption-status-label" style={{ marginBottom: 24, fontSize: 8 }}>
                SISTEMA_DE_INYECCION_DE_METADATOS_v1.0<br />
                ASSETS_LOCALES: {products.length}
            </div>

            {isAddingProduct && (
                <div className="settings-group" style={{ background: 'rgba(255,255,255,0.02)', padding: '20px', border: '0.5px solid rgba(255,255,255,0.1)', marginBottom: 20 }}>
                    <div className="settings-group-label" style={{ marginBottom: 16 }}>_SINCRONIZAR_SHOPIFY (BETA)</div>
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                            <span className="vault-subtitle" style={{ fontSize: 7, opacity: 0.4 }}>DOMINIO_TIENDA</span>
                            <input
                                className="pin-input"
                                placeholder="tu-tienda.myshopify.com"
                                value={shopifyDomain}
                                onChange={(e) => setShopifyDomain(e.target.value.toLowerCase())}
                                style={{ background: 'transparent', border: '0.5px solid rgba(255,255,255,0.2)', padding: '12px', color: '#fff' }}
                            />
                        </div>
                        <button
                            className="request-btn"
                            onClick={handleShopifySync}
                            disabled={isSyncingShopify}
                            style={{ borderColor: '#9C27B0', color: '#9C27B0' }}
                        >
                            {isSyncingShopify ? '[ SINCRONIZANDO... ]' : '[ INYECTAR_TODO_EL_CATALOGO ]'}
                        </button>
                        <div className="vault-subtitle" style={{ fontSize: 6, opacity: 0.3, textAlign: 'center' }}>
                            ESTA OPERACIÓN SUCCIONARÁ LOS METADATOS PÚBLICOS DE LA TIENDA.
                        </div>
                    </div>
                </div>
            )}

            {isAddingProduct ? (
                <div className="settings-group" style={{ background: 'rgba(255,255,255,0.02)', padding: '20px', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                    <div className="settings-group-label" style={{ marginBottom: 16 }}>_NUEVO_PRODUCTO</div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div className="flex flex-col gap-1">
                            <span className="vault-subtitle" style={{ fontSize: 7, opacity: 0.4 }}>REF_ID / SKU</span>
                            <input
                                className="pin-input"
                                placeholder="P001"
                                value={newProduct.id}
                                onChange={(e) => setNewProduct({ ...newProduct, id: e.target.value.toUpperCase() })}
                                style={{ background: 'transparent', border: '0.5px solid rgba(255,255,255,0.2)', padding: '12px', color: '#fff', fontFamily: 'var(--font-mono)' }}
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="vault-subtitle" style={{ fontSize: 7, opacity: 0.4 }}>NOMBRE_ASSET</span>
                            <input
                                className="pin-input"
                                placeholder="TITULO_DEL_PRODUCTO"
                                value={newProduct.name}
                                onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                                style={{ background: 'transparent', border: '0.5px solid rgba(255,255,255,0.2)', padding: '12px', color: '#fff', fontFamily: 'var(--font-mono)' }}
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="vault-subtitle" style={{ fontSize: 7, opacity: 0.4 }}>VALOR_USD</span>
                            <input
                                className="pin-input"
                                placeholder="0.00"
                                value={newProduct.price}
                                onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })}
                                style={{ background: 'transparent', border: '0.5px solid rgba(255,255,255,0.2)', padding: '12px', color: '#fff', fontFamily: 'var(--font-mono)' }}
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="vault-subtitle" style={{ fontSize: 7, opacity: 0.4 }}>URL_IMAGEN_EXTERNA</span>
                            <input
                                className="pin-input"
                                placeholder="HTTPS://..."
                                value={newProduct.imageUrl}
                                onChange={(e) => setNewProduct({ ...newProduct, imageUrl: e.target.value })}
                                style={{ background: 'transparent', border: '0.5px solid rgba(255,255,255,0.2)', padding: '12px', color: '#fff', fontSize: 10 }}
                            />
                        </div>

                        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                            <button className="request-btn" onClick={handleSaveProduct} style={{ flex: 2, borderColor: '#00f2ff', color: '#00f2ff' }}>
                                [ GUARDAR_REGISTRO ]
                            </button>
                            <button className="request-btn" onClick={() => setIsAddingProduct(false)} style={{ flex: 1, opacity: 0.5 }}>
                                [ CANCELAR ]
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                <button className="settings-item" onClick={() => setIsAddingProduct(true)} style={{ color: '#00f2ff', border: '1px dashed rgba(0,242,255,0.3)', justifyContent: 'center', padding: '16px', borderRadius: 0 }}>
                    <span className="material-symbols-outlined">add_circle</span>
                    <span className="settings-item-label" style={{ fontSize: 12 }}>_INYECTAR_NUEVO_PRODUCTO</span>
                </button>
            )}

            <div style={{ height: 40 }} />

            <div className="catalog-list" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {products.length === 0 && !isAddingProduct && (
                    <div className="vault-subtitle" style={{ opacity: 0.2, textAlign: 'center', padding: '40px 0' }}>_NO_HAY_PRODUCTOS_CONFIGURADOS_</div>
                )}
                {products.map((p) => (
                    <div key={p.id} className="settings-item" style={{ alignItems: 'center', padding: '16px 0', borderBottom: '0.5px solid rgba(255,255,255,0.05)', borderLeft: 'none' }}>
                        <div style={{ width: 50, height: 50, background: '#0a0a0a', border: '0.5px solid rgba(255,255,255,0.1)', overflow: 'hidden', marginRight: 16 }}>
                            <img src={p.imageUrl} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => (e.currentTarget.style.display = 'none')} />
                        </div>
                        <div className="flex-1">
                            <div className="product-name" style={{ fontSize: 11, color: '#fff' }}>{p.name.toUpperCase()}</div>
                            <div className="product-price" style={{ fontSize: 11, color: '#00f2ff' }}>${p.price}</div>
                            <div className="vault-subtitle" style={{ fontSize: 7, opacity: 0.4, marginTop: 2 }}>
                                {new URL(p.imageUrl).hostname.toUpperCase()} | ID: {p.id}
                            </div>
                        </div>
                        <button
                            className="header-icon-btn"
                            onClick={() => handleDeleteProduct(p.id)}
                            style={{ border: 'none', background: 'transparent', color: '#ff4444', opacity: 0.5 }}
                        >
                            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>delete</span>
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <div className="settings-screen">
            {/* Header */}
            <header className="conv-header">
                <button className="conv-back-btn" onClick={handleBack}>
                    <span className="material-symbols-outlined">chevron_left</span>
                </button>
                <div className="conv-header-info">
                    <h1 className="conv-header-pin">SETTINGS_{getSectionTitle()}</h1>
                </div>
                <div style={{ width: 40, display: 'flex', justifyContent: 'flex-end', opacity: 0.4 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>terminal</span>
                </div>
            </header>

            {/* Content */}
            <div className="settings-list" style={{ padding: '80px 24px 24px' }}>
                {renderSection()}
            </div>
        </div>
    );
}
