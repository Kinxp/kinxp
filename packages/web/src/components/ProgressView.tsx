// src/components/ProgressView.tsx
import React, { useState } from 'react';
import { SpinnerIcon } from './Icons';

interface ProgressViewProps {
  logs: string[];
  showManualCheckButton?: boolean;
  onManualCheck?: () => void;
  isChecking?: boolean;
  lzTxHash?: `0x${string}` | null;
}

const ProgressView: React.FC<ProgressViewProps> = ({
  logs,
  showManualCheckButton,
  onManualCheck,
  isChecking,
  lzTxHash
}) => {
  // NEW: toggle to hide/show the debug "terminal"
  const [showDebug, setShowDebug] = useState(true);

  return (
    <div className="bg-gray-800 rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <SpinnerIcon />
          <h3 className="text-xl font-bold text-yellow-300">Transaction in Progress...</h3>
        </div>

        {/* NEW: Debug toggle button */}
        <button
          onClick={() => setShowDebug(v => !v)}
          aria-expanded={showDebug}
          className="text-xs font-semibold bg-gray-700 hover:bg-gray-600 text-gray-100 px-3 py-1.5 rounded-md transition-colors"
        >
          {showDebug ? 'Close Debug' : 'Open Debug'}
        </button>
      </div>

      {/* LayerZero Scan link, unchanged */}
      {lzTxHash && (
        <div className="text-center pt-2">
            <a 
              href={`https://testnet.layerzeroscan.com/tx/${lzTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-cyan-400 hover:text-cyan-300 transition-colors"
            >
                Track Cross-Chain Message ↗
            </a>
            <p className="text-xs text-gray-500 mt-1">(This can take several minutes to confirm)</p>
        </div>
      )}

      {/* NEW: Collapsible debug "terminal" */}
      {showDebug && (
        <div className="bg-black/50 rounded-lg p-4 font-mono text-xs text-gray-300 h-64 overflow-y-auto whitespace-pre-wrap">
          {logs?.length ? logs.join('\n') : 'No logs yet.'}
        </div>
      )}

      {/* Manual check button (optional) */}
      {showManualCheckButton && (
        <div className="pt-4 border-t border-gray-700">
          <p className="text-xs text-center text-gray-500 mb-2">
            If this is taking too long, you can check the status on Hedera manually.
          </p>
          <button
            onClick={onManualCheck}
            disabled={isChecking}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg disabled:opacity-50"
          >
            {isChecking ? 'Checking...' : 'Check Status on Hedera Manually'}
          </button>
        </div>
      )}
    </div>
  );
};

export default ProgressView;
