import { useState } from "react";
const API = import.meta.env.VITE_API_BASE || "http://localhost:8787";
const EXPLORER = (import.meta.env.VITE_AUTOSCOUT_EXPLORER_URL || "").replace(/\/$/, "");

export default function App() {
  return (
    <div style={{ maxWidth: 980, margin: "20px auto", padding: 16 }}>
      <h1>KINXP - Explain-to-Pay</h1>
      <p>Escrow releases only after explainable, link-backed proof (Blockscout MCP). Settlement on Hedera.</p>
      <Panels />
    </div>
  );
}

function Panels() {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <ExplainTx />
      <RiskScan />
      <VerifyRelease />
    </div>
  );
}

function ExplainTx() {
  const [chainId, setChain] = useState(8453);
  const [hash, setHash] = useState("");
  const [out, setOut] = useState<any>(null);

  const run = async () => {
    const r = await fetch(`${API}/ai/explain-tx`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chainId, txHash: hash }) });
    setOut(await r.json());
  };

  return (
    <section style={card}>
      <h3>Explain a Transaction</h3>
      <Row>
        <label>Chain ID <input value={chainId} onChange={e => setChain(parseInt(e.target.value))} /></label>
        <label>Tx Hash <input style={{ width: 460 }} value={hash} onChange={e => setHash(e.target.value)} /></label>
        <button onClick={run}>Explain</button>
      </Row>
      {out && <pre style={pre}>{JSON.stringify(out, null, 2)}</pre>}
      {hash && EXPLORER && <a href={`${EXPLORER}/tx/${hash}`} target="_blank">View in Explorer</a>}
    </section>
  );
}

function RiskScan() {
  const [chainId, setChain] = useState(42161);
  const [addr, setAddr] = useState("");
  const [out, setOut] = useState<any>(null);

  const run = async () => {
    const r = await fetch(`${API}/ai/risk-scan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chainId, address: addr }) });
    setOut(await r.json());
  };

  return (
    <section style={card}>
      <h3>Wallet Risk Scan (7d)</h3>
      <Row>
        <label>Chain ID <input value={chainId} onChange={e => setChain(parseInt(e.target.value))} /></label>
        <label>Address <input style={{ width: 560 }} value={addr} onChange={e => setAddr(e.target.value)} /></label>
        <button onClick={run}>Scan</button>
      </Row>
      {out && <pre style={pre}>{JSON.stringify(out, null, 2)}</pre>}
      {addr && EXPLORER && <a href={`${EXPLORER}/address/${addr}`} target="_blank">View in Explorer</a>}
    </section>
  );
}

function VerifyRelease() {
  const [xcond, setX] = useState(`{\n  "chainId": 8453,\n  "contract": "0x...",\n  "event": "FeatureDeployed(address indexed who, bytes32 featureId)",\n  "filters": {"who": "0x..."},\n  "minConfirmations": 5,\n  "usdFloor": 1000\n}`);
  const [out, setOut] = useState<any>(null);

  const run = async (path: string) => {
    const r = await fetch(`${API}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ xCondition: JSON.parse(xcond) }) });
    setOut(await r.json());
  };

  return (
    <section style={card}>
      <h3>Verify &rarr; Release</h3>
      <textarea style={{ width: "100%", height: 160, fontFamily: "monospace" }} value={xcond} onChange={e => setX(e.target.value)} />
      <Row>
        <button onClick={() => run("/ai/verify-milestone")}>Verify (AI Proof Card)</button>
        <button onClick={() => run("/escrow/release")}>Release Funds</button>
      </Row>
      {out && <pre style={pre}>{JSON.stringify(out, null, 2)}</pre>}
    </section>
  );
}

const card: React.CSSProperties = { padding: 16, border: "1px solid #e5e7eb", borderRadius: 12 };
function Row(props: any){ return <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>{props.children}</div>; }
const pre: React.CSSProperties = { background: "#0b1020", color: "#e6e6e6", padding: 12, borderRadius: 8, overflow: "auto" };
