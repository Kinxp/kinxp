// This file extends the Window interface to include the ethereum property
declare interface Window {
  ethereum?: {
    isMetaMask?: boolean;
    isStatus?: boolean;
    host?: string;
    pathname?: string;
    port?: string;
    request: (request: { method: string; params?: any[] }) => Promise<any>;
    send?: (method: string, params?: any[]) => Promise<any>;
    sendAsync?: (request: { method: string; params?: any[] }) => Promise<any>;
    on?: (event: string, callback: (...args: any[]) => void) => void;
    removeListener?: (event: string, callback: (...args: any[]) => void) => void;
    autoRefreshOnNetworkChange?: boolean;
    chainId?: string;
    networkVersion?: string;
    selectedAddress?: string;
  };
}
