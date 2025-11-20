import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';

interface LogContextType {
  logs: string[];
  error: string | null;
  addLog: (log: string) => void;
  setError: (error: string | null) => void;
  setLogs: React.Dispatch<React.SetStateAction<string[]>>;
}

const LogContext = createContext<LogContextType | undefined>(undefined);

export function LogProvider({ children }: { children: ReactNode }) {
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const addLog = useCallback((log: string) => {
    setLogs(prev => [...prev, log]);
  }, []);

  const value = useMemo(() => ({
    logs, error, addLog, setError, setLogs
  }), [logs, error, addLog]);

  return <LogContext.Provider value={value}>{children}</LogContext.Provider>;
}

export const useLogs = () => {
  const context = useContext(LogContext);
  if (!context) throw new Error('useLogs must be used within LogProvider');
  return context;
};