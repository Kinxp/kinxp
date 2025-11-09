// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

library MessageTypes {
    uint8 internal constant FUNDED = 0;
    uint8 internal constant REPAID = 1;
    uint8 internal constant LIQUIDATED = 2; // payload (Hedera -> Eth): orderId, reserveId, liquidator, payout, seizedWei
}
