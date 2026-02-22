import React, { useState, useEffect } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import { Store } from "../store";
import { loadConfig } from "../config";
import Overview from "./screens/Overview";
import Sessions from "./screens/Sessions";
import Detail from "./screens/Detail";

type Screen = "overview" | "sessions" | "detail";

function App({ store }: { store: Store }) {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>("overview");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  useInput((input, key) => {
    if (input === "q") {
      exit();
      return;
    }
    if (input === "1") setScreen("overview");
    if (input === "2") setScreen("sessions");
    if (key.escape) {
      if (screen === "detail") setScreen("sessions");
    }
  });

  const openDetail = (id: string) => {
    setSelectedSessionId(id);
    setScreen("detail");
  };

  return (
    <Box flexDirection="column" width="100%">
      {/* Header */}
      <Box borderStyle="single" borderColor="blue" paddingX={1}>
        <Text bold color="blue">jin</Text>
        <Text color="gray"> │ </Text>
        <Text color={screen === "overview" ? "white" : "gray"} bold={screen === "overview"}>
          [1] Overview
        </Text>
        <Text color="gray"> │ </Text>
        <Text color={screen === "sessions" ? "white" : "gray"} bold={screen === "sessions"}>
          [2] Sessions
        </Text>
        <Text color="gray"> │ </Text>
        <Text color={screen === "detail" ? "white" : "gray"} bold={screen === "detail"}>
          [3] Detail
        </Text>
        <Text color="gray"> │ q=quit</Text>
      </Box>

      {/* Content */}
      <Box flexDirection="column" paddingX={1} paddingY={1} flexGrow={1}>
        {screen === "overview" && <Overview store={store} />}
        {screen === "sessions" && <Sessions store={store} onSelect={openDetail} />}
        {screen === "detail" && (
          <Detail store={store} sessionId={selectedSessionId} />
        )}
      </Box>
    </Box>
  );
}

export async function launchTui() {
  const config = await loadConfig();
  const store = new Store(config.store.dbPath);

  const { waitUntilExit } = render(<App store={store} />);
  await waitUntilExit();
  store.close();
}
