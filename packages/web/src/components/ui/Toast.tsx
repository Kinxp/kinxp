import React from 'react';
import { X } from 'lucide-react';
import { ToastData } from '../../hooks/useToast';

interface ToastProps extends ToastData {
  onDismiss: (id: string) => void;
}

export const Toast: React.FC<ToastProps> = ({
  id,
  title,
  description,
  variant = 'default',
  onDismiss,
}) => {
  const variantClasses = {
    default: 'bg-gray-800 text-white',
    destructive: 'bg-red-600 text-white',
    success: 'bg-green-600 text-white',
  };

  return (
    <div
      className={`${variantClasses[variant]} rounded-lg shadow-lg p-4 mb-2 flex justify-between items-start max-w-md`}
      role="alert"
    >
      <div className="flex-1">
        <h3 className="font-medium">{title}</h3>
        {description && <p className="text-sm opacity-90">{description}</p>}
      </div>
      <button
        onClick={() => onDismiss(id)}
        className="ml-4 text-white opacity-70 hover:opacity-100 focus:outline-none"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};

export const ToastContainer: React.FC<{
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}> = ({ toasts, onDismiss }) => {
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {toasts.map((toast) => (
        <Toast key={toast.id} {...toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};
