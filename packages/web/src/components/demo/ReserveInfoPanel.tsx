import React from 'react';
import { MockReserveInfo } from '../../types/demo';

interface ReserveInfoPanelProps {
  reserve: MockReserveInfo;
}

const ReserveInfoPanel: React.FC<ReserveInfoPanelProps> = ({ reserve }) => {
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-200">Reserve Configuration</h4>
        <span className={`text-xs px-2 py-1 rounded-full ${
          reserve.active 
            ? 'bg-green-600/20 text-green-300 border border-green-500/30' 
            : 'bg-red-600/20 text-red-300 border border-red-500/30'
        }`}>
          {reserve.active ? 'Active' : 'Inactive'}
        </span>
      </div>
      
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-gray-500 mb-1">Max LTV</p>
          <p className="text-gray-200 font-mono">{reserve.maxLtvBps / 100}%</p>
        </div>
        <div>
          <p className="text-gray-500 mb-1">Liquidation Threshold</p>
          <p className="text-gray-200 font-mono">{reserve.liquidationThresholdBps / 100}%</p>
        </div>
        <div>
          <p className="text-gray-500 mb-1">Interest Rate (APR)</p>
          <p className="text-gray-200 font-mono">{reserve.baseRateBps / 100}%</p>
        </div>
        <div>
          <p className="text-gray-500 mb-1">Origination Fee</p>
          <p className="text-gray-200 font-mono">{reserve.originationFeeBps / 100}%</p>
        </div>
      </div>
      
      <div className="pt-2 border-t border-gray-700/50">
        <p className="text-xs text-gray-500 mb-1">Controller</p>
        <p className="text-xs font-mono text-gray-400 break-all">{reserve.controller}</p>
      </div>
    </div>
  );
};

export default ReserveInfoPanel;

