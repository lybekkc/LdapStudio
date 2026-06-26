import React from "react";
import { Layout, Splitter } from "antd";
import Toolbar from "./components/Toolbar";
import ConnectionDialog from "./components/ConnectionDialog";
import DitTree from "./components/DitTree";
import EntryDetails from "./components/EntryDetails";
import SchemaBrowser from "./components/SchemaBrowser";
import SearchView from "./components/SearchView";
import CompareSchemaView from "./components/CompareSchemaView";
import LogPanel from "./components/LogPanel";
import { useAppStore } from "./store/appStore";
import { useKeyboardShortcuts } from "./utils/useKeyboardShortcuts";

const { Content } = Layout;

const App: React.FC = () => {
  const { activeTab, browserSplitSize, setBrowserSplitSize } = useAppStore();
  useKeyboardShortcuts();

  return (
    <Layout style={{ height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <Toolbar />

      <Layout style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

          <Content
            style={{ display: activeTab === "schema" ? "flex" : "none",
                     flex: 1, overflow: "auto", background: "#fff", flexDirection: "column" }}
          >
            <SchemaBrowser />
          </Content>

          <Content
            style={{ display: activeTab === "search" ? "flex" : "none",
                     flex: 1, overflow: "hidden", background: "#fff", flexDirection: "column" }}
          >
            <SearchView />
          </Content>

          <Content
            style={{ display: activeTab === "compare" ? "flex" : "none",
                     flex: 1, overflow: "hidden", background: "#fff", flexDirection: "column" }}
          >
            <CompareSchemaView />
          </Content>

          {/* Browser: resizable left/right split */}
          <Splitter
            style={{ display: activeTab === "browser" ? "flex" : "none",
                     flex: 1, background: "#fff" }}
            onResizeEnd={(sizes) => setBrowserSplitSize(sizes[0])}
          >
            <Splitter.Panel
              defaultSize={browserSplitSize}
              min={180}
              max="60%"
              style={{ overflow: "auto", borderRight: "1px solid #f0f0f0" }}
            >
              <DitTree />
            </Splitter.Panel>
            <Splitter.Panel style={{ overflow: "auto" }}>
              <EntryDetails />
            </Splitter.Panel>
          </Splitter>

        </div>

        <LogPanel />

      </Layout>

      <ConnectionDialog />
    </Layout>
  );
};

export default App;
