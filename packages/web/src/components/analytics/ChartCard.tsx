import React, { ReactNode } from 'react';
import { SpinnerIcon } from '../Icons';

interface ChartCardProps {
  title: string;
  isLoading: boolean;
  error: string | null;
  children: ReactNode;
}

const ChartCard: React.FC<ChartCardProps> = ({ title, isLoading, error, children }) => {
  return (
    <div className="bg-gray-800 rounded-2xl p-6">
      <h2 className="text-xl font-semibold mb-4">{title}</h2>
      <div style={{ width: '100%', minWidth: 0, minHeight: 400 }}>
        {isLoading ? (
          <div className="flex justify-center items-center h-[400px] gap-2 text-gray-400">
            <SpinnerIcon />
            <span>Loading Chart Data...</span>
          </div>
        ) : error ? (
          <div className="flex justify-center items-center h-[400px] text-red-400">
            <p>{error}</p>
          </div>
        ) : (
          <div className="w-full h-[400px] min-h-[400px]">
            {children}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChartCard;