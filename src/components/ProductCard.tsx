/**
 * ProductCard — Componente de Tienda por Inyección de Metadatos
 * 
 * Basado en la arquitectura Zero-Knowledge: 
 * - Sin almacenamiento local de archivos.
 * - Renderizado mediante Asset Fetching externo.
 */

'use client';

import React, { useState, useEffect } from 'react';

interface ProductCardProps {
    name: string;
    price: string | number;
    imageUrl: string;
    productId: string;
    onSelect?: (id: string) => void;
}

export default function ProductCard({ name, price, imageUrl, productId, onSelect }: ProductCardProps) {
    const [hasError, setHasError] = useState(false);
    const [domain, setDomain] = useState('');

    useEffect(() => {
        try {
            const url = new URL(imageUrl);
            setDomain(url.hostname.toUpperCase());
        } catch {
            setDomain('UNKNOWN_SOURCE');
            setHasError(true);
        }
    }, [imageUrl]);

    return (
        <div className="product-card-container">
            {/* Marco Neón Fino */}
            <div className="product-card-frame">

                {/* Visual Asset Area */}
                <div className="product-asset-box">
                    {hasError ? (
                        <div className="no-signal-overlay">
                            <div className="interference-lines"></div>
                            <span className="interference-text">ASSET_NOT_FOUND</span>
                        </div>
                    ) : (
                        <img
                            src={imageUrl}
                            alt={name}
                            className="product-image"
                            onError={() => setHasError(true)}
                        />
                    )}
                </div>

                {/* Metadata Info */}
                <div className="product-info">
                    <div className="flex justify-between items-start mb-2">
                        <h3 className="product-name">{name.toUpperCase()}</h3>
                        <span className="product-price">${price}</span>
                    </div>

                    <div className="metadata-tag">
                        <span className="material-symbols-outlined" style={{ fontSize: 10 }}>hub</span>
                        HOSTED_BY: {domain}
                    </div>

                    <button
                        className="request-btn"
                        onClick={() => onSelect?.(productId)}
                    >
                        [ REQUEST_ITEM ]
                    </button>

                    <div className="product-id-tag">REF_ID: {productId}</div>
                </div>
            </div>
        </div>
    );
}
