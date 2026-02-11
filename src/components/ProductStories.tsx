/**
 * ProductStories — Carrusel de productos estilo WhatsApp Status
 * 
 * Funcionalidades:
 * - Ciclo automático de productos (5 segundos por item)
 * - Barras de progreso segmentadas
 * - Navegación: Izquierda (volver), Derecha (avanzar)
 * - Acción: Al tocar la información, lleva al chat con el producto
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { type LocalProduct } from '@/lib/db';

interface ProductStoriesProps {
    products: LocalProduct[];
    onClose: () => void;
    onSelectProduct: (product: LocalProduct) => void;
}

export default function ProductStories({ products, onClose, onSelectProduct }: ProductStoriesProps) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [progress, setProgress] = useState(0);

    const activeProduct = products[currentIndex];

    const nextStory = useCallback(() => {
        if (currentIndex < products.length - 1) {
            setCurrentIndex(prev => prev + 1);
            setProgress(0);
        } else {
            onClose();
        }
    }, [currentIndex, products.length, onClose]);

    const prevStory = useCallback(() => {
        if (currentIndex > 0) {
            setCurrentIndex(prev => prev - 1);
            setProgress(0);
        }
    }, [currentIndex]);

    // Timer para el progreso
    useEffect(() => {
        const interval = setInterval(() => {
            nextStory();
        }, 5000);

        return () => clearInterval(interval);
    }, [nextStory]);

    if (!activeProduct) return null;

    return (
        <div className="story-viewer-overlay">
            {/* Barras de Progreso */}
            <div className="story-progress-container">
                {products.map((_, index) => (
                    <div key={index} className="story-progress-bg">
                        <div
                            className={`story-progress-fill ${index === currentIndex ? 'active' : ''} ${index < currentIndex ? 'completed' : ''}`}
                        />
                    </div>
                ))}
            </div>

            {/* Cabecera / Botón Cerrar */}
            <div className="flex justify-between items-center p-4 pt-12 z-10">
                <div className="flex items-center gap-3">
                    <div style={{ width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', border: '1px solid #fff' }}>
                        <img src={activeProduct.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                    <span className="vault-subtitle" style={{ fontSize: 10, fontWeight: 700, color: '#fff' }}>MIRANDO_CATALOGO</span>
                </div>
                <button
                    onClick={onClose}
                    className="text-white opacity-60 hover:opacity-100"
                    style={{ background: 'transparent', border: 'none' }}
                >
                    <span className="material-symbols-outlined">close</span>
                </button>
            </div>

            {/* Contenido Visual */}
            <div className="story-content">
                {/* Áreas de Navegación */}
                <div className="story-nav-area story-nav-prev" onClick={prevStory} />
                <div className="story-nav-area story-nav-next" onClick={nextStory} />

                <img
                    src={activeProduct.imageUrl}
                    alt={activeProduct.name}
                    className="story-main-img"
                />

                {/* Panel de Información (Lleva al chat) */}
                <div className="story-info-panel" onClick={() => onSelectProduct(activeProduct)}>
                    <div className="story-product-name">{activeProduct.name.toUpperCase()}</div>
                    <div className="story-product-price">${activeProduct.price}</div>

                    <div className="flex items-center gap-2 mt-4 text-[#00f2ff] font-mono text-[10px] animate-pulse">
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>chat_bubble</span>
                        [ TOCAR_PARA_SOLICITAR_EN_EL_CHAT ]
                    </div>
                </div>
            </div>
        </div>
    );
}
