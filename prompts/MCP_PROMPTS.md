# Blockscout MCP - Prompt Pack (X2P)

> Use with Claude Desktop or Cursor.
> Ensure the MCP server is configured: https://mcp.blockscout.com/mcp

## A) Explain a transaction
Given `CHAIN_ID` and `TX_HASH`:
- Call `transaction_summary(chain_id, hash)` then `get_transaction_logs(chain_id, hash)`.
- If ABI missing, `get_contract_abi`.
- Return JSON: `{ method, transfers[], fee, risks[], links[] }`.

## B) Wallet risk sweep (7d)
Given `CHAIN_ID` and `ADDRESS`:
- `get_transactions_by_address` + `get_tokens_by_address`.
- Flag unlimited approvals, large novel outflows, risky tags.
- Return JSON `{ bullets[], links[] }`.

## C) Verify milestone (X-Condition)
Given an X-Condition JSON (contract/event/filters/confirms):
- Pull logs & summary; confirm filters and confirmations.
- Return JSON `{ ok, reasons[], links[], confs }`.
