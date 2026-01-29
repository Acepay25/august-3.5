/**
 * useNetworkStatus - Hook to track online/offline status
 */

import { useState, useEffect, useCallback } from 'react';

export interface NetworkStatus {
    isOnline: boolean;
    wasOffline: boolean; // True if we just came back online
}

export function useNetworkStatus(): NetworkStatus {
    const [isOnline, setIsOnline] = useState(() =>
        typeof navigator !== 'undefined' ? navigator.onLine : true
    );
    const [wasOffline, setWasOffline] = useState(false);

    useEffect(() => {
        const handleOnline = () => {
            setWasOffline(!navigator.onLine === false && !isOnline);
            setIsOnline(true);
        };

        const handleOffline = () => {
            setWasOffline(false);
            setIsOnline(false);
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [isOnline]);

    // Reset wasOffline after it's been true for a moment
    useEffect(() => {
        if (wasOffline) {
            const timeout = setTimeout(() => setWasOffline(false), 3000);
            return () => clearTimeout(timeout);
        }
    }, [wasOffline]);

    return { isOnline, wasOffline };
}

export default useNetworkStatus;
