import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css"
import { NotificationProvider, TransactionPopupProvider } from "@blockscout/app-sdk";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <NotificationProvider>
      <TransactionPopupProvider>
        <App />
      </TransactionPopupProvider>
    </NotificationProvider>
  </React.StrictMode>
);
