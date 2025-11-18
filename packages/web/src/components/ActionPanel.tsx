import React from 'react';
import { AppState } from '../types';
import { UserOrderSummary } from '../types';

// Import the new hook and views
import { useActionPanelState } from './actionpanel/useActionPanelState';
import { InProgressViews } from './actionpanel/InProgressViews';
import { ManageOrderView } from './actionpanel/ManageOrderView';

interface ActionPanelProps {
  allOrders: UserOrderSummary[];
}

const ActionPanel: React.FC<ActionPanelProps> = ({ allOrders }) => {
  // Call the hook to get all state and logic
  const state = useActionPanelState(allOrders);

  // 1. If an action is in progress, render the appropriate status view.
  if (
    state.appState !== AppState.IDLE &&
    state.appState !== AppState.LOAN_ACTIVE &&
    state.appState !== AppState.READY_TO_WITHDRAW
  ) {
    return <InProgressViews {...state} />;
  }

  // 2. If an order is selected, render the management view for it.
  if (state.selectedOrder) {
    return <ManageOrderView {...state} />;
  }
  
  // 3. If nothing is happening and nothing is selected, show the create view.
  // Note: Your DashboardPage now renders this separately, so this can be a hint.
  return (
    <div className="bg-gray-800/50 rounded-xl p-6 text-center text-gray-400">
      Select an order from the right to manage it.
    </div>
  );
};

export default ActionPanel;
