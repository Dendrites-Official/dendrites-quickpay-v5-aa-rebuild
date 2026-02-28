import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import App from "./App";
import "./styles/fonts.css";
import "./index.css";
import { wagmiConfig } from "./wallet/wagmi";
import { AppModeProvider } from "./demo/AppModeContext";
import { DemoReceiptsProvider } from "./demo/DemoReceiptsStore";
import { DemoAckLinkProvider } from "./demo/demoAckLinkStore";


const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppModeProvider>
            <DemoReceiptsProvider>
              <DemoAckLinkProvider>
                <App />
              </DemoAckLinkProvider>
            </DemoReceiptsProvider>
          </AppModeProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>
);
