# Contract Adaptation Analysis

## Executive Summary

**Overall Assessment: MODERATE EFFORT REQUIRED** ⚠️

The new contract architecture introduces several improvements (reserve system, partial repayments, collateral additions) that will enhance the UI's capabilities. The adaptation is **straightforward** but requires **systematic updates** across multiple files. The changes maintain backward compatibility through the `horders` compatibility function, making migration smoother.

---

## Key Contract Changes

### 1. **EthCollateralOApp.sol** - Enhanced Order Management

#### New Order Structure
```solidity
struct Order {
    address owner;
    bytes32 reserveId;        // NEW: Reserve identifier
    uint256 amountWei;
    uint256 unlockedWei;       // NEW: Available for withdrawal (partial repayments)
    bool funded;
    bool repaid;
    bool liquidated;
}
```

#### Breaking Changes
- `orders(bytes32)` now returns **7 fields** instead of 5:
  - Old: `(address owner, uint256 amountWei, bool funded, bool repaid, bool liquidated)`
  - New: `(address owner, bytes32 reserveId, uint256 amountWei, uint256 unlockedWei, bool funded, bool repaid, bool liquidated)`

#### New Features
- ✅ `createOrderIdWithReserve(bytes32 reserveId)` - Create order with specific reserve
- ✅ `setOrderReserve(bytes32 orderId, bytes32 reserveId)` - Change reserve before funding
- ✅ `addCollateral(bytes32 orderId)` - Add collateral without notifying Hedera
- ✅ `addCollateralWithNotify(bytes32 orderId, uint256 topUpAmountWei)` - Add collateral + notify
- ✅ `withdraw(bytes32 orderId)` - Now supports partial withdrawals via `unlockedWei`
- ✅ `quoteAddCollateralNativeFee(bytes32 orderId, uint256 topUpAmountWei)` - Fee quote for top-ups

#### New Events
- `OrderReserveUpdated(bytes32 indexed orderId, bytes32 indexed newReserveId)`
- `CollateralUnlocked(bytes32 indexed orderId, bytes32 indexed reserveId, uint256 unlockedAmount, uint256 totalUnlocked, bool fullyRepaid)`
- `CollateralAdded(bytes32 indexed orderId, bytes32 indexed reserveId, address indexed user, uint256 addedAmountWei, uint256 newTotalCollateralWei)`

### 2. **HederaCreditOApp.sol** - Reserve-Based System

#### Key Changes
- ✅ Uses `ReserveRegistry` for configuration (LTV, interest rates, oracle settings)
- ✅ `borrowWithReserve(bytes32 reserveId, bytes32 orderId, ...)` - Borrow with specific reserve
- ✅ `getOutstandingDebt(bytes32 orderId)` - More accurate debt calculation
- ✅ `repay()` now supports **partial repayments** and unlocks proportional collateral
- ✅ `horders()` compatibility function still exists (backward compatible)

#### Improved Debt Tracking
- Old: Read `borrowedUsd` from `horders()` (static value)
- New: Use `getOutstandingDebt()` which accounts for accrued interest

### 3. **ReserveRegistry.sol** - New Configuration System

#### Purpose
Centralized registry for reserve configurations:
- Risk parameters (LTV, liquidation thresholds)
- Interest rate settings
- Oracle configuration
- Controller addresses

#### UI Impact
- Need to query registry for LTV, interest rates, etc.
- Can support multiple reserves in the future
- More dynamic configuration

---

## Required UI Changes

### 🔴 **CRITICAL** - Must Fix Immediately

#### 1. Update ABI Definitions (`config.ts`)

**File:** `packages/web/src/config.ts`

```typescript
// OLD - BREAKS
export const ETH_COLLATERAL_ABI = parseAbi([
  "function orders(bytes32) view returns (address owner, uint256 amountWei, bool funded, bool repaid, bool liquidated)",
  // ...
]);

// NEW - FIXED
export const ETH_COLLATERAL_ABI = parseAbi([
  "function orders(bytes32) view returns (address owner, bytes32 reserveId, uint256 amountWei, uint256 unlockedWei, bool funded, bool repaid, bool liquidated)",
  "function createOrderIdWithReserve(bytes32 reserveId) returns (bytes32)",
  "function setOrderReserve(bytes32 orderId, bytes32 reserveId)",
  "function addCollateral(bytes32 orderId) payable",
  "function addCollateralWithNotify(bytes32 orderId, uint256 topUpAmountWei) payable",
  "function quoteAddCollateralNativeFee(bytes32 orderId, uint256 topUpAmountWei) view returns (uint256)",
  "event OrderReserveUpdated(bytes32 indexed orderId, bytes32 indexed newReserveId)",
  "event CollateralUnlocked(bytes32 indexed orderId, bytes32 indexed reserveId, uint256 unlockedAmount, uint256 totalUnlocked, bool fullyRepaid)",
  "event CollateralAdded(bytes32 indexed orderId, bytes32 indexed reserveId, address indexed user, uint256 addedAmountWei, uint256 newTotalCollateralWei)",
  // ... existing functions
]);

export const HEDERA_CREDIT_ABI = parseAbi([
  // ... existing
  "function borrowWithReserve(bytes32 reserveId, bytes32 orderId, uint64 amount, bytes[] calldata priceUpdateData, uint32 pythMaxAgeSec) payable",
  "function getOutstandingDebt(bytes32 orderId) view returns (uint256)",
  // ... existing
]);

// NEW: ReserveRegistry ABI
export const RESERVE_REGISTRY_ABI = parseAbi([
  "function getReserveConfig(bytes32 reserveId) view returns ((bytes32 reserveId, string label, address controller, address protocolTreasury, uint8 debtTokenDecimals, bool active, bool frozen) metadata, (uint16 maxLtvBps, uint16 liquidationThresholdBps, uint16 liquidationBonusBps, uint16 closeFactorBps, uint16 reserveFactorBps, uint16 liquidationProtocolFeeBps) risk, (uint32 baseRateBps, uint32 slope1Bps, uint32 slope2Bps, uint32 optimalUtilizationBps, uint16 originationFeeBps) interest, (bytes32 priceId, uint32 heartbeatSeconds, uint32 maxStalenessSeconds, uint16 maxConfidenceBps, uint16 maxDeviationBps) oracle)",
  "function getMetadata(bytes32 reserveId) view returns (bytes32 reserveId, string label, address controller, address protocolTreasury, uint8 debtTokenDecimals, bool active, bool frozen)",
  "function getRiskConfig(bytes32 reserveId) view returns (uint16 maxLtvBps, uint16 liquidationThresholdBps, uint16 liquidationBonusBps, uint16 closeFactorBps, uint16 reserveFactorBps, uint16 liquidationProtocolFeeBps)",
  "function defaultReserveId() view returns (bytes32)",
]);
```

#### 2. Fix Order Data Parsing (`blockscoutService.ts`)

**File:** `packages/web/src/services/blockscoutService.ts`

```typescript
// OLD - BREAKS (line 103)
const [owner, amountWei, funded, repaid, liquidated] = ethCallResult.result as [ `0x${string}`, bigint, boolean, boolean, boolean ];

// NEW - FIXED
const [owner, reserveId, amountWei, unlockedWei, funded, repaid, liquidated] = ethCallResult.result as [ 
  `0x${string}`, 
  `0x${string}`,  // reserveId
  bigint,         // amountWei
  bigint,         // unlockedWei
  boolean,        // funded
  boolean,        // repaid
  boolean         // liquidated
];
```

#### 3. Update Type Definitions (`types.ts`)

**File:** `packages/web/src/types.ts`

```typescript
export interface UserOrderSummary {
  orderId: `0x${string}`;
  amountWei: bigint;
  unlockedWei?: bigint;        // NEW: Available for withdrawal
  reserveId?: `0x${string}`;  // NEW: Reserve identifier
  status: OrderStatus;
  borrowedUsd?: bigint;
}
```

### 🟡 **IMPORTANT** - Enhance Functionality

#### 4. Use `getOutstandingDebt()` for Accurate Debt Tracking

**File:** `packages/web/src/context/AppContext.tsx` and related files

**Current:** Uses `horders().borrowedUsd` (doesn't account for interest)

**Recommended:** Use `getOutstandingDebt()` for real-time debt including accrued interest

```typescript
// In calculateBorrowAmount or similar functions
const outstandingDebt = await readContract(wagmiConfig, {
  address: HEDERA_CREDIT_OAPP_ADDR,
  abi: HEDERA_CREDIT_ABI,
  functionName: 'getOutstandingDebt',
  args: [orderId],
  chainId: HEDERA_CHAIN_ID,
}) as bigint;
```

#### 5. Add Reserve Selection UI

**New Component:** `packages/web/src/components/dashboard/ReserveSelector.tsx`

- Query `ReserveRegistry` for available reserves
- Display reserve labels, LTV, interest rates
- Allow users to select reserve when creating order
- Show current reserve for existing orders

#### 6. Add "Add Collateral" Feature

**New Component:** `packages/web/src/components/actionpanel/manageorder/AddCollateralView.tsx`

- Input field for additional ETH amount
- Quote LayerZero fee using `quoteAddCollateralNativeFee()`
- Call `addCollateralWithNotify()` with proper fee calculation
- Update order display to show new total collateral

#### 7. Support Partial Withdrawals

**File:** `packages/web/src/components/actionpanel/manageorder/WithdrawView.tsx`

- Display `unlockedWei` amount (available for withdrawal)
- Show both `amountWei` (total collateral) and `unlockedWei` (withdrawable)
- Update withdraw button to show available amount
- Handle partial withdrawals gracefully

### 🟢 **NICE TO HAVE** - Professional Enhancements

#### 8. Enhanced Order Status Display

- Show reserve information (label, LTV, interest rate)
- Display unlocked collateral vs total collateral
- Show accrued interest on debt
- Better liquidation risk indicators using reserve thresholds

#### 9. Reserve Configuration Display

- Create a "Reserve Info" panel showing:
  - Current LTV
  - Liquidation threshold
  - Interest rate
  - Oracle status

#### 10. Improved Error Handling

- Handle reserve-specific errors
- Better messages for reserve mismatches
- Validation for reserve selection

---

## Migration Strategy

### Phase 1: Critical Fixes (Immediate)
1. ✅ Update ABIs in `config.ts`
2. ✅ Fix order data parsing in `blockscoutService.ts`
3. ✅ Update type definitions
4. ✅ Test order creation and funding

### Phase 2: Core Features (Week 1)
1. ✅ Implement `getOutstandingDebt()` usage
2. ✅ Add reserve selection (default to existing behavior)
3. ✅ Support partial withdrawals display
4. ✅ Test all existing flows

### Phase 3: New Features (Week 2)
1. ✅ Add collateral feature
2. ✅ Reserve configuration display
3. ✅ Enhanced status indicators
4. ✅ Professional UI polish

---

## Backward Compatibility

✅ **Good News:** The contracts maintain backward compatibility:
- `horders()` function still exists
- Default reserve system works without explicit selection
- Existing orders continue to function

⚠️ **Note:** New orders will use the default reserve if not specified.

---

## Testing Checklist

- [ ] Order creation (with and without reserve)
- [ ] Order funding
- [ ] Borrowing (with default reserve)
- [ ] Partial repayment
- [ ] Partial withdrawal
- [ ] Add collateral
- [ ] Full repayment and withdrawal
- [ ] Order status display
- [ ] Debt calculation accuracy

---

## Estimated Effort

- **Critical Fixes:** 2-4 hours
- **Core Features:** 1-2 days
- **New Features:** 2-3 days
- **Testing & Polish:** 1-2 days

**Total:** ~1 week for full adaptation with professional polish

---

## Professional UI Recommendations

### Visual Enhancements
1. **Reserve Badge:** Show reserve label as a badge on orders
2. **Collateral Breakdown:** Visual bar showing locked vs unlocked collateral
3. **Debt Accrual Indicator:** Show how debt grows over time
4. **Reserve Comparison:** If multiple reserves exist, show comparison table

### UX Improvements
1. **Smart Defaults:** Auto-select best reserve based on user's collateral amount
2. **Fee Transparency:** Show LayerZero fees clearly before transactions
3. **Progress Indicators:** Better feedback for cross-chain operations
4. **Error Recovery:** Clear guidance when reserve operations fail

---

## Conclusion

The adaptation is **moderately complex** but **well-structured**. The contracts are designed with backward compatibility in mind, making migration smoother. The new features (reserves, partial operations) will significantly enhance the user experience once implemented.

**Recommendation:** Start with Phase 1 (critical fixes) immediately, then proceed with phases 2 and 3 for a polished, professional interface.



