/**
 * Toast Notification System
 * Provides visual feedback for user actions and errors
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
    id: string;
    type: ToastType;
    title: string;
    message?: string;
    duration?: number;
    action?: {
        label: string;
        onClick: () => void;
    };
}

interface ToastContextType {
    toasts: Toast[];
    addToast: (toast: Omit<Toast, 'id'>) => string;
    removeToast: (id: string) => void;
    clearAll: () => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};

// Convenience methods
export const useToastActions = () => {
    const { addToast } = useToast();

    return {
        success: (title: string, message?: string) =>
            addToast({ type: 'success', title, message }),
        error: (title: string, message?: string, action?: Toast['action']) =>
            addToast({ type: 'error', title, message, action, duration: 8000 }),
        warning: (title: string, message?: string) =>
            addToast({ type: 'warning', title, message }),
        info: (title: string, message?: string) =>
            addToast({ type: 'info', title, message }),
    };
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
        const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        setToasts(prev => [...prev, { ...toast, id }]);
        return id;
    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const clearAll = useCallback(() => {
        setToasts([]);
    }, []);

    return (
        <ToastContext.Provider value={{ toasts, addToast, removeToast, clearAll }}>
            {children}
            <ToastContainer />
        </ToastContext.Provider>
    );
};

const ToastContainer: React.FC = () => {
    const { toasts, removeToast } = useToast();

    return (
        <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
            {toasts.map(toast => (
                <ToastItem key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
            ))}
        </div>
    );
};

const ToastItem: React.FC<{ toast: Toast; onDismiss: () => void }> = ({ toast, onDismiss }) => {
    const duration = toast.duration ?? 5000;

    useEffect(() => {
        if (duration > 0) {
            const timer = setTimeout(onDismiss, duration);
            return () => clearTimeout(timer);
        }
    }, [duration, onDismiss]);

    const typeStyles = {
        success: 'bg-emerald-900/90 border-emerald-500/50 text-emerald-100',
        error: 'bg-rose-900/90 border-rose-500/50 text-rose-100',
        warning: 'bg-amber-900/90 border-amber-500/50 text-amber-100',
        info: 'bg-cyan-900/90 border-cyan-500/50 text-cyan-100',
    };

    const iconStyles = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ',
    };

    return (
        <div
            className={`pointer-events-auto p-4 rounded-xl border backdrop-blur-md shadow-xl animate-slide-in-right ${typeStyles[toast.type]}`}
            role="alert"
            aria-live="polite"
        >
            <div className="flex items-start gap-3">
                <span className="text-lg flex-shrink-0">{iconStyles[toast.type]}</span>
                <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm">{toast.title}</p>
                    {toast.message && (
                        <p className="text-xs opacity-80 mt-0.5">{toast.message}</p>
                    )}
                    {toast.action && (
                        <button
                            onClick={() => {
                                toast.action!.onClick();
                                onDismiss();
                            }}
                            className="mt-2 text-xs font-bold underline hover:no-underline"
                        >
                            {toast.action.label}
                        </button>
                    )}
                </div>
                <button
                    onClick={onDismiss}
                    className="text-current opacity-60 hover:opacity-100 transition-opacity flex-shrink-0"
                    aria-label="Dismiss"
                >
                    ✕
                </button>
            </div>
        </div>
    );
};

export default ToastProvider;
