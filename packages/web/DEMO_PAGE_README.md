# Future Demo Page - Implementation Guide

## Overview

The Future Demo Page (`/demo`) showcases the enhanced UI features that will be available after the contract adaptation is complete. It uses **mock data** to demonstrate the new functionality and can be easily updated to use real contracts once they're deployed.

## Features Demonstrated

### 1. **Reserve System**
- Reserve badges showing which reserve each order uses
- Reserve information panel displaying:
  - Max LTV (Loan-to-Value)
  - Liquidation threshold
  - Interest rates (APR)
  - Origination fees
  - Controller address

### 2. **Partial Withdrawals**
- Enhanced withdraw view showing:
  - Total collateral locked
  - Unlocked collateral (from partial repayments)
  - Visual progress bar
  - Clear indication of what can be withdrawn

### 3. **Add Collateral**
- New component to add collateral to existing orders
- Shows current vs new total collateral
- Estimates LayerZero fees
- Improves LTV ratio and reduces liquidation risk

### 4. **Enhanced Order Display**
- Shows reserve information for each order
- Displays unlocked collateral amount
- Shows outstanding debt (including accrued interest)
- Better status indicators

## File Structure

```
packages/web/src/
├── pages/
│   └── FutureDemoPage.tsx          # Main demo page
├── components/demo/
│   ├── ReserveBadge.tsx            # Reserve badge component
│   ├── ReserveInfoPanel.tsx        # Reserve configuration display
│   ├── AddCollateralView.tsx       # Add collateral feature
│   └── EnhancedWithdrawView.tsx    # Enhanced withdrawal with partial support
└── types/
    └── demo.ts                      # Mock data types
```

## How to Access

1. Navigate to `/demo` in your browser
2. Or click "Future Demo" in the header navigation

## Mock Data

The demo uses realistic mock data to simulate:
- Multiple orders in different states
- Reserve configurations
- Partial repayments and unlocked collateral
- Outstanding debt with accrued interest

### Mock Data Location

All mock data is defined in `FutureDemoPage.tsx`:
- `MOCK_RESERVES`: Reserve configurations
- `MOCK_ORDERS`: Sample orders with various states

## Updating to Real Contracts

When contracts are deployed, update the following:

### 1. Replace Mock Reserves

```typescript
// In FutureDemoPage.tsx, replace:
const MOCK_RESERVES: MockReserveInfo[] = [...];

// With:
const fetchReserves = async () => {
  const defaultReserveId = await readContract({
    address: RESERVE_REGISTRY_ADDR,
    abi: RESERVE_REGISTRY_ABI,
    functionName: 'defaultReserveId',
  });
  
  const config = await readContract({
    address: RESERVE_REGISTRY_ADDR,
    abi: RESERVE_REGISTRY_ABI,
    functionName: 'getReserveConfig',
    args: [defaultReserveId],
  });
  
  return [config];
};
```

### 2. Replace Mock Orders

```typescript
// Replace MOCK_ORDERS with real contract reads:
const fetchOrders = async (userAddress: string) => {
  // Get order IDs from events (existing logic)
  const orderIds = await fetchOrderIdsForUser(userAddress);
  
  // Read from EthCollateralOApp
  const ethOrders = await multicall({
    contracts: orderIds.map(id => ({
      address: ETH_COLLATERAL_OAPP_ADDR,
      abi: ETH_COLLATERAL_ABI,
      functionName: 'orders',
      args: [id],
    })),
  });
  
  // Read outstanding debt from HederaCreditOApp
  const debts = await Promise.all(
    orderIds.map(id => 
      readContract({
        address: HEDERA_CREDIT_OAPP_ADDR,
        abi: HEDERA_CREDIT_ABI,
        functionName: 'getOutstandingDebt',
        args: [id],
        chainId: HEDERA_CHAIN_ID,
      })
    )
  );
  
  // Combine into MockOrderSummary format
  return orderIds.map((id, i) => ({
    orderId: id,
    reserveId: ethOrders[i].result[1], // New field
    amountWei: ethOrders[i].result[2],
    unlockedWei: ethOrders[i].result[3], // New field
    outstandingDebt: debts[i],
    // ... other fields
  }));
};
```

### 3. Replace Mock Handlers

```typescript
// Replace handleAddCollateral with:
const handleAddCollateral = async (amountEth: string) => {
  const amountWei = parseEther(amountEth);
  const fee = await readContract({
    address: ETH_COLLATERAL_OAPP_ADDR,
    abi: ETH_COLLATERAL_ABI,
    functionName: 'quoteAddCollateralNativeFee',
    args: [selectedOrderId, amountWei],
  });
  
  await writeContract({
    address: ETH_COLLATERAL_OAPP_ADDR,
    abi: ETH_COLLATERAL_ABI,
    functionName: 'addCollateralWithNotify',
    args: [selectedOrderId, amountWei],
    value: amountWei + fee,
  });
};

// Similar updates for other handlers...
```

### 4. Update Contract Addresses

Update addresses in `config.ts`:
- `ETH_COLLATERAL_OAPP_ADDR`
- `HEDERA_CREDIT_OAPP_ADDR`
- `RESERVE_REGISTRY_ADDR` (new)

## Component Reusability

All demo components are designed to work with real data:

- **ReserveBadge**: Works with any reserve label and LTV
- **ReserveInfoPanel**: Accepts `MockReserveInfo` (can be replaced with real reserve config)
- **AddCollateralView**: Ready for real contract calls
- **EnhancedWithdrawView**: Works with real `unlockedWei` values

## Testing Checklist

- [x] Demo page loads without errors
- [x] Order selection works
- [x] Reserve badges display correctly
- [x] Add collateral view shows proper calculations
- [x] Enhanced withdraw view shows unlocked amounts
- [x] All mock handlers provide user feedback
- [ ] Real contract integration (after deployment)
- [ ] Error handling for contract calls
- [ ] Loading states for async operations

## Notes

- All mock data is clearly marked with `MOCK_` prefix
- Mock handlers use `console.log` and `alert` for demonstration
- Replace these with real contract calls when ready
- The UI is fully functional and ready for contract integration

## Next Steps

1. Deploy contracts to testnet
2. Update contract addresses in `config.ts`
3. Replace mock data with real contract reads
4. Replace mock handlers with real contract writes
5. Test all flows end-to-end
6. Remove mock data and demo warnings


