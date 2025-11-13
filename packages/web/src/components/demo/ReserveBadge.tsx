import React from 'react';

interface ReserveBadgeProps {
  reserveLabel: string;
  maxLtvBps?: number;
  className?: string;
}

const ReserveBadge: React.FC<ReserveBadgeProps> = ({ 
  reserveLabel, 
  maxLtvBps,
  className = '' 
}) => {
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <span className="text-xs font-semibold bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 px-2.5 py-1 rounded-full">
        {reserveLabel}
      </span>
      {maxLtvBps !== undefined && (
        <span className="text-xs text-gray-400">
          {maxLtvBps / 100}% LTV
        </span>
      )}
    </div>
  );
};

export default ReserveBadge;

