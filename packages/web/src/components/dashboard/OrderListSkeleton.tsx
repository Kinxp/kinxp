import React from 'react';

const SkeletonItem = () => (
  <div className="bg-gray-900/60 border border-gray-700/40 rounded-xl px-4 py-3 h-[70px] animate-pulse">
    <div className="flex items-center justify-between h-full">
        <div className="space-y-2">
            <div className="h-4 bg-gray-700 rounded w-32"></div>
            <div className="h-3 bg-gray-700 rounded w-20"></div>
        </div>
        <div className="h-8 bg-gray-700 rounded-md w-20"></div>
    </div>
  </div>
);

const OrderListSkeleton: React.FC = () => {
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 space-y-3">
        <div className="h-5 bg-gray-700 rounded w-48 mb-3 animate-pulse"></div>
        <SkeletonItem />
        <SkeletonItem />
    </div>
  );
};

export default OrderListSkeleton;