// src/components/UserOrders.tsx

import React, { useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';

// Import the service function we created earlier
import { fetchAllUserOrders } from '../../services/blockscoutService';
// Import the shared types for consistency
import { UserOrderSummary } from '../../types';
// Import the presentational component that will display the data
import OrderList from './OrderList';

/**
 * A self-contained component that fetches, manages, and displays a user's order history.
 * It acts as a "container" for the OrderList component.
 */
const UserOrders: React.FC = () => {
  // Get the connected wallet's information
  const { address, isConnected } = useAccount();

  // State management for the component's data, loading status, and errors
  const [orders, setOrders] = useState<UserOrderSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * A memoized function to handle the fetching of orders.
   * This can be called to manually refresh the list.
   */
  const handleRefresh = useCallback(async () => {
    // Ensure an address is available before making a request
    if (!address) return;

    // Set the initial loading state and clear any previous errors
    setIsLoading(true);
    setError(null);
    try {
      // Call our service function to get the data from Blockscout and Ethereum
      const userOrders = await fetchAllUserOrders(address);
      setOrders(userOrders);
    } catch (e: any) {
      // If an error occurs, store a user-friendly message
      console.error("Failed to fetch user orders:", e);
      setError('Could not retrieve order history. Please try again.');
    } finally {
      // Always ensure the loading state is turned off after the request completes
      setIsLoading(false);
    }
  }, [address]); // This function depends only on the user's address

  /**
   * An effect that runs when the component is first mounted or when the user's
   * connection status or address changes.
   */
  useEffect(() => {
    if (isConnected && address) {
      // If the user is connected, automatically fetch their orders
      handleRefresh();
    } else {
      // If the user disconnects, clear the list of orders
      setOrders([]);
    }
  }, [isConnected, address, handleRefresh]); // Dependencies for the effect

  // Don't render anything if the user's wallet is not connected
  if (!isConnected) {
    return null; // Or you could return a "Please connect your wallet" message
  }

  // Render the presentational OrderList component, passing down the current
  // state (orders, isLoading, error) and the refresh function as props.
  return (
    <OrderList
      orders={orders}
      isLoading={isLoading}
      error={error}
      onRefresh={handleRefresh}
    />
  );
};

export default UserOrders;