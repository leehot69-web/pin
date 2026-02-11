/**
 * PIN App — Main Entry Point
 * 
 * Orchestrates screen navigation:
 * Vault → Chats → Conversation
 */

'use client';

import React, { useEffect, useState } from 'react';
import { usePinStore } from '@/store/pinStore';
import { useConnectionManager } from '@/hooks/useConnectionManager';
import { pinDb } from '@/lib/db';
import VaultScreen from '@/components/VaultScreen';
import ChatsScreen from '@/components/ChatsScreen';
import ConversationScreen from '@/components/ConversationScreen';
import SettingsScreen from '@/components/SettingsScreen';
import { supabase } from '@/lib/supabase';

export default function PinApp() {
  const { currentScreen, identity } = usePinStore();
  const [isLoading, setIsLoading] = useState(true);

  // Connection manager (heartbeat, polling, etc.)
  useConnectionManager();

  // Init IndexedDB and check for existing session
  useEffect(() => {
    const init = async () => {
      try {
        await pinDb.init();

        // Implement Session Lease (30 days)
        const lastAccess = localStorage.getItem('pin-last-usage');
        const now = Date.now();
        if (lastAccess) {
          const diff = now - parseInt(lastAccess);
          const thirtyDays = 30 * 24 * 60 * 60 * 1000;
          if (diff > thirtyDays) {
            console.warn('[PIN] Sesión expirada por inactividad prolongada (30 días)');
            await supabase.auth.signOut();
            localStorage.clear();
            // Recargar para limpiar estados
            window.location.reload();
            return;
          }
        }
        localStorage.setItem('pin-last-usage', now.toString());

      } catch (err) {
        console.error('[PIN] DB init error:', err);
      }
      setIsLoading(false);
    };
    init();
  }, []);

  // Register service worker
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // SW registration failed — not critical
      });
    }
  }, []);

  // Online/Offline listeners
  useEffect(() => {
    const handleOnline = () => usePinStore.getState().setIsOnline(true);
    const handleOffline = () => usePinStore.getState().setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Auto-lock timer
  useEffect(() => {
    if (currentScreen === 'vault' || !identity) return;

    let timeout: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      if (timeout) clearTimeout(timeout);

      const lockMinutes = parseInt(localStorage.getItem('pin-auto-lock') || '5');
      if (lockMinutes === 0) return; // 'Never'

      timeout = setTimeout(() => {
        console.log(`[PIN] Auto-locking after ${lockMinutes}m of inactivity`);
        usePinStore.getState().setCurrentScreen('vault');
      }, lockMinutes * 60 * 1000);
    };

    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    events.forEach(ev => window.addEventListener(ev, resetTimer));

    resetTimer(); // Start initial timer

    return () => {
      events.forEach(ev => window.removeEventListener(ev, resetTimer));
      if (timeout) clearTimeout(timeout);
    };
  }, [currentScreen, identity]);

  if (isLoading) {
    return (
      <div className="pin-app">
        <div className="loading-screen">
          <div className="loading-spinner" />
          <p className="loading-text">Iniciando Bóveda...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pin-app">
      {currentScreen === 'vault' && <VaultScreen />}
      {currentScreen === 'chats' && <ChatsScreen />}
      {currentScreen === 'conversation' && <ConversationScreen />}
      {currentScreen === 'settings' && <SettingsScreen />}
    </div>
  );
}
