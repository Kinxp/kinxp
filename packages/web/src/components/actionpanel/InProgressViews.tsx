import React from 'react';
import ProgressView from './ProgressView';
import FundOrderView from './FundOrderView';
import { AppState } from '../../types';

interface InProgressViewsProps {
  appState: AppState;
  logs: string[];
  lzTxHash: `0x${string}` | null;
  error: string | null;
  resetFlow: () => void;
  exitProgressView: () => void;
  newlyCreatedOrderId: `0x${string}` | null;
  ethAmount: string;
  handleFundOrder: (amount: string) => void;
}

export const InProgressViews: React.FC<InProgressViewsProps> = (props) => {
  switch (props.appState) {
    case AppState.ORDER_CREATED:
      return <FundOrderView orderId={props.newlyCreatedOrderId!} ethAmount={props.ethAmount} onFund={props.handleFundOrder} />;
    case AppState.COMPLETED:
      return <div className="text-center space-y-4"><h3 className="text-2xl font-bold text-green-400">✅ Success!</h3><p>Action completed.</p><button onClick={props.resetFlow} className="bg-cyan-600 hover:bg-cyan-700 font-bold py-2 px-4 rounded-lg">Start Over</button></div>;
    case AppState.ERROR:
      return <div className="text-center space-y-4"><h3 className="text-2xl font-bold text-red-400">❌ Error</h3><p className="text-sm text-gray-400 mt-2">{props.error}</p><button onClick={props.resetFlow} className="bg-cyan-600 hover:bg-cyan-700 font-bold py-2 px-4 rounded-lg">Try Again</button></div>;
    default:
      return <ProgressView logs={props.logs} lzTxHash={props.lzTxHash} onExit={props.exitProgressView} />;
  }
};