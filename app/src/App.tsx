import React from "react";
import { Layout, Splitter } from "antd";
import Toolbar from "./components/Toolbar";
import ConnectionDialog from "./components/ConnectionDialog";
import DitTree from "./components/DitTree";
import EntryDetails from "./components/EntryDetails";
import SchemaBrowser from "./components/SchemaBrowser";
import SearchView from "./components/SearchView";
import { useAppStore } from "./store/appStore";

const { Content } = Layout;

const App: React.FC = () => {
  const { activeTab, browserSplitSize, setBrowserSplitSize } = useAppStore();

  return (
    <Layout style={{ height: "100vh", overflow: "hidden" }}>
      <Toolbar />

      <Layout style={{ flex: 1, overflow: "hidden" }}>

        {/* All three tabs stay mounted — toggled with CSS display to preserve state */}

        <Content
          style={{ display: activeTab === "schema" ? "flex" : "none",
                   overflow: "auto", background: "#fff", flexDirection: "column" }}
        >
          <SchemaBrowser />
        </Content>

        <Content
          style={{ display: activeTab === "search" ? "flex" : "none",
                   overflow: "hidden", background: "#fff", flexDirection: "column" }}
        >
          <SearchView />
        </Content>

        {/* Browser: resizable left/right split */}
        <Splitter
          style={{ display: activeTab === "browser" ? "flex" : "none",
                   height: "100%", background: "#fff" }}
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

      </Layout>

      <ConnectionDialog />
    </Layout>
  );
};

export default App;
