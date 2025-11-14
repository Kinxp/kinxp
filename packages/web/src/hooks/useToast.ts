import { useState, useCallback } from 'react';

type ToastVariant = 'default' | 'destructive' | 'success';

export interface ToastData {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const toast = useCallback(({ title, description, variant = 'default' }: Omit<ToastData, 'id'>) => {
    const id = Math.random().toString(36).substr(2, 9);
    const newToast = { id, title, description, variant };
    
    setToasts((currentToasts) => [...currentToasts, newToast]);
    
    // Auto-remove toast after 5 seconds
    setTimeout(() => {
      setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== id));
    }, 5000);
    
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== id));
  }, []);

  return {
    toasts,
    toast,
    removeToast,
  };
}
