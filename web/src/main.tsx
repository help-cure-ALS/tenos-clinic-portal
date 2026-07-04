import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider, v8CssVariablesResolver } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { ModalsProvider } from "@mantine/modals";

import "./i18n";
import "./index.css";
import { theme } from "./theme";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider theme={theme} cssVariablesResolver={v8CssVariablesResolver}>
      <Notifications position="top-right" pauseResetOnHover="notification" />
      <ModalsProvider>
        <App />
      </ModalsProvider>
    </MantineProvider>
  </StrictMode>
);
