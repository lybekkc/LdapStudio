import React, { useState, useEffect } from "react";
import { Button, Space, Tag, Tooltip, Typography, Popover, Drawer, Form, InputNumber, Switch, Divider, Modal, Badge } from "antd";
import {
  ApiOutlined, DisconnectOutlined, DatabaseOutlined,
  ApartmentOutlined, SearchOutlined, InfoCircleOutlined,
  SettingOutlined, TagsOutlined, LockOutlined, UnlockOutlined,
  LoadingOutlined, WifiOutlined, CloseCircleOutlined,
  DownloadOutlined, UploadOutlined, TableOutlined, HistoryOutlined,
  QuestionCircleOutlined, CopyOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../store/appStore";
import { MAX_RECONNECT_ATTEMPTS } from "../store/appStore";
import { LdifExportDialog, LdifImportDialog } from "./LdifDialog";
import CsvExportDialog from "./CsvExportDialog";
import UndoHistoryDrawer from "./UndoHistoryDrawer";
import ShortcutsModal from "./ShortcutsModal";
import type { AppTab } from "../types";
import { LdapIcon } from "./LdapIcon";

const { Text } = Typography;

const Toolbar: React.FC = () => {
  const {
    connected,
    serverInfo,
    activeTab,
    setActiveTab,
    disconnectFromServer,
    setShowConnectionDialog,
    pageSize, setPageSize,
    showOcBrowser, setShowOcBrowser,
    showOcSearch, setShowOcSearch,
    activeProfile,
    writeUnlocked,
    setWriteUnlocked,
    reconnecting,
    reconnectAttempt,
    reconnectIn,
    reconnectFailed,
    cancelReconnect,
    undoHistory,
    historyDrawerOpen,
    setHistoryDrawerOpen,
    clipboardEntry,
    clearEntryClipboard,
    refreshDitTree,
    setActiveBaseDn,
  } = useAppStore();

  const [settingsOpen,   setSettingsOpen]   = useState(false);
  const [exportOpen,     setExportOpen]     = useState(false);
  const [importOpen,     setImportOpen]     = useState(false);
  const [csvExportOpen,  setCsvExportOpen]  = useState(false);
  const [shortcutsOpen,  setShortcutsOpen]  = useState(false);

  // Listen for global "show-shortcuts" event (triggered by "?" key)
  useEffect(() => {
    const handler = () => setShortcutsOpen(true);
    window.addEventListener("show-shortcuts", handler);
    return () => window.removeEventListener("show-shortcuts", handler);
  }, []);

  const handleUnlock = () => {
    Modal.confirm({
      title: "Aktiver skrivetilgang?",
      icon: <UnlockOutlined style={{ color: "#fa8c16" }} />,
      content: (
        <div>
          <p>Du er i ferd med å aktivere skrivetilgang for:</p>
          <p><strong>{activeProfile?.name}</strong> ({activeProfile?.host})</p>
          <p style={{ color: "#d4380d" }}>
            ⚠️ Denne tilkoblingen er markert som <strong>read-only</strong>. Vær forsiktig med endringer!
          </p>
        </div>
      ),
      okText: "Lås opp",
      okButtonProps: { danger: true },
      cancelText: "Avbryt",
      onOk: () => setWriteUnlocked(true),
    });
  };

  const navItems: { key: AppTab; icon: React.ReactNode; label: string }[] = [
    { key: "browser", icon: <ApartmentOutlined />, label: "Browser" },
    { key: "search",  icon: <SearchOutlined />,    label: "Search" },
    { key: "schema",  icon: <DatabaseOutlined />,  label: "Schema" },
  ];

  const serverInfoPopover = serverInfo && (
    <div style={{ minWidth: 280 }}>
      <div><Text type="secondary">Vendor:</Text> {serverInfo.vendorName ?? "Unknown"}</div>
      <div><Text type="secondary">Version:</Text> {serverInfo.vendorVersion ?? "Unknown"}</div>
      <div><Text type="secondary">LDAP versions:</Text> {serverInfo.supportedLdapVersions.join(", ")}</div>
      <div><Text type="secondary">SASL:</Text> {serverInfo.supportedSaslMechanisms.join(", ") || "—"}</div>
      <div><Text type="secondary">Naming contexts:</Text></div>
      {serverInfo.namingContexts.map((nc) => (
        <div key={nc} style={{ paddingLeft: 12, marginTop: 2 }}>
          <Text
            code
            style={{
              fontSize: 11,
              cursor: "pointer",
              background: nc === serverInfo.activeBaseDn ? "#1677ff22" : undefined,
              borderColor: nc === serverInfo.activeBaseDn ? "#1677ff" : undefined,
            }}
            onClick={() => { if (nc !== serverInfo.activeBaseDn) setActiveBaseDn(nc); }}
            title={nc === serverInfo.activeBaseDn ? "Aktiv base DN" : "Klikk for å bytte til denne"}
          >
            {nc === serverInfo.activeBaseDn ? "▶ " : ""}{nc}
          </Text>
        </div>
      ))}
    </div>
  );

  return (
    <>
    <div
      style={{
        height: 48,
        background: "#001529",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 16,
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
        <LdapIcon size={22} style={{ color: "#38bdf8", flexShrink: 0 }} />
        <Text strong style={{ color: "#fff", fontSize: 15 }}>
          LDAP Studio
        </Text>
      </div>

      <div style={{ width: 1, height: 24, background: "#ffffff30" }} />

      {/* Nav tabs */}
      <Space>
        {navItems.map((item) => (
          <Button
            key={item.key}
            type={activeTab === item.key ? "primary" : "text"}
            icon={item.icon}
            onClick={() => setActiveTab(item.key)}
            disabled={!connected}
            style={{ color: connected ? (activeTab === item.key ? undefined : "#ffffffaa") : "#ffffff40" }}
          >
            {item.label}
          </Button>
        ))}
      </Space>

      <div style={{ flex: 1 }} />

      {/* LDIF Import / Export */}
      {connected && (
        <Space size={4}>
          <Tooltip title="Eksporter til LDIF">
            <Button type="text" size="small" icon={<DownloadOutlined />}
              onClick={() => setExportOpen(true)} style={{ color: "#ffffffaa" }} />
          </Tooltip>
          <Tooltip title="Eksporter til CSV / Excel">
            <Button type="text" size="small" icon={<TableOutlined />}
              onClick={() => setCsvExportOpen(true)} style={{ color: "#ffffffaa" }} />
          </Tooltip>
          <Tooltip title="Importer fra LDIF">
            <Button type="text" size="small" icon={<UploadOutlined />}
              onClick={() => setImportOpen(true)} style={{ color: "#ffffffaa" }} />
          </Tooltip>
          <Tooltip title={`Operation history (${undoHistory.length}) — ⌘H`}>
            <Badge count={undoHistory.length} size="small" offset={[-4, 4]}>
              <Button type="text" size="small" icon={<HistoryOutlined />}
                onClick={() => setHistoryDrawerOpen(true)} style={{ color: "#ffffffaa" }} />
            </Badge>
          </Tooltip>
          {clipboardEntry && (
            <Tooltip title={
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Clipboard — ⌘V to paste</div>
                <div style={{ fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" }}>
                  {clipboardEntry.sourceDn}
                </div>
                <div style={{ fontSize: 11, marginTop: 2, opacity: 0.8 }}>
                  {clipboardEntry.objectClasses.join(", ")}
                </div>
                <div style={{ fontSize: 11, marginTop: 4 }}>
                  <span
                    style={{ cursor: "pointer", textDecoration: "underline" }}
                    onClick={clearEntryClipboard}
                  >
                    Clear clipboard
                  </span>
                </div>
              </div>
            }>
              <Badge dot color="#faad14" offset={[-4, 4]}>
                <Button
                  type="text" size="small" icon={<CopyOutlined />}
                  style={{ color: "#faad14" }}
                />
              </Badge>
            </Tooltip>
          )}
        </Space>
      )}

      {/* Settings button */}
      <Tooltip title="Innstillinger">
        <Button
          type="text"
          icon={<SettingOutlined />}
          onClick={() => setSettingsOpen(true)}
          style={{ color: "#ffffffaa" }}
        />
      </Tooltip>

      {/* Keyboard shortcuts */}
      <Tooltip title="Keyboard shortcuts (?)">
        <Button
          type="text"
          icon={<QuestionCircleOutlined />}
          onClick={() => setShortcutsOpen(true)}
          style={{ color: "#ffffffaa" }}
        />
      </Tooltip>

      {/* Connection status */}
      {connected && serverInfo ? (
        <Space>
          {/* Read-only / write-unlocked indicator */}
          {activeProfile?.readOnly && (
            writeUnlocked ? (
              <Tooltip title="Skrivetilgang er aktiv — klikk for å låse igjen">
                <Tag
                  color="warning"
                  icon={<UnlockOutlined />}
                  style={{ cursor: "pointer" }}
                  onClick={() => setWriteUnlocked(false)}
                >
                  Skrivetilgang aktiv
                </Tag>
              </Tooltip>
            ) : (
              <Tooltip title="Read-only tilkobling — klikk for å låse opp midlertidig">
                <Tag
                  color="default"
                  icon={<LockOutlined />}
                  style={{ cursor: "pointer", color: "#fff", background: "#722ed1", borderColor: "#722ed1" }}
                  onClick={handleUnlock}
                >
                  Read-only
                </Tag>
              </Tooltip>
            )
          )}
          <Tag color="green" style={{ marginRight: 0 }}>Connected</Tag>
          <Text style={{ color: "#ffffffaa", fontSize: 12, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {serverInfo.vendorName ? `${serverInfo.vendorName} — ` : ""}{serverInfo.activeBaseDn}
          </Text>
          <Popover
            content={serverInfoPopover}
            title="Server info"
            trigger="click"
            placement="bottomRight"
          >
            <Tooltip title="Server details">
              <Button type="text" size="small" icon={<InfoCircleOutlined />} style={{ color: "#ffffffaa" }} />
            </Tooltip>
          </Popover>
          <Tooltip title="Disconnect">
            <Button
              type="text"
              icon={<DisconnectOutlined />}
              danger
              onClick={disconnectFromServer}
              style={{ color: "#ff7875" }}
            />
          </Tooltip>
        </Space>
      ) : (
        <Tooltip title="Connect to LDAP server">
          <Button type="primary" icon={<ApiOutlined />} onClick={() => setShowConnectionDialog(true)}>
            Connect
          </Button>
        </Tooltip>
      )}

      {/* ── Settings Drawer ──────────────────────────────────────────────────── */}
      <Drawer
        title={<span><SettingOutlined style={{ marginRight: 8 }} />Innstillinger</span>}
        placement="right"
        width={320}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      >
        <Form layout="vertical" size="small">

          <Divider orientation="left" style={{ fontSize: 12, color: "#888" }}>Søk og navigasjon</Divider>

          <Form.Item label="Antall resultater per side (paging)">
            <InputNumber
              min={10}
              max={10000}
              step={50}
              value={pageSize}
              onChange={(v) => { if (v && v > 0) setPageSize(v); }}
              style={{ width: "100%" }}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>
              Brukes for både søkeresultater og DIT-treet
            </Text>
          </Form.Item>

          <Divider orientation="left" style={{ fontSize: 12, color: "#888" }}>Object Class-visning</Divider>

          <Form.Item>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <TagsOutlined style={{ color: "#1677ff" }} />
                <span>Vis i Browser-treet</span>
              </span>
              <Switch checked={showOcBrowser} onChange={setShowOcBrowser} />
            </div>
            <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 4 }}>
              Viser object class-tagger ved siden av hvert noden i DIT-treet
            </Text>
          </Form.Item>

          <Form.Item>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <TagsOutlined style={{ color: "#1677ff" }} />
                <span>Vis i Søkeresultater</span>
              </span>
              <Switch checked={showOcSearch} onChange={setShowOcSearch} />
            </div>
            <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 4 }}>
              Viser object class-tagger i søkeresultat-listen
            </Text>
          </Form.Item>

        </Form>

        <div style={{ marginTop: 24, padding: "12px", background: "#f6ffed", border: "1px solid #b7eb8f", borderRadius: 6 }}>
          <Text style={{ fontSize: 11, color: "#52c41a" }}>
            ✓ Innstillinger lagres automatisk
          </Text>
        </div>
      </Drawer>

    </div>

    {/* ── Reconnect banner ───────────────────────────────────────────────────── */}
    {(reconnecting || reconnectFailed) && (
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "5px 16px", flexShrink: 0,
        background: reconnectFailed ? "#fff1f0" : "#fffbe6",
        borderBottom: `1px solid ${reconnectFailed ? "#ffa39e" : "#ffe58f"}`,
      }}>
        {reconnectFailed ? (
          <>
            <CloseCircleOutlined style={{ color: "#cf1322", fontSize: 14 }} />
            <Text style={{ fontSize: 12, color: "#cf1322" }}>
              Tilkobling mistet — kunne ikke koble til på nytt automatisk.
            </Text>
            <Button
              size="small"
              type="primary"
              icon={<ApiOutlined />}
              onClick={() => setShowConnectionDialog(true)}
              style={{ marginLeft: 8 }}
            >
              Koble til manuelt
            </Button>
          </>
        ) : (
          <>
            <LoadingOutlined style={{ color: "#d46b08", fontSize: 14 }} spin />
            <Text style={{ fontSize: 12, color: "#d46b08" }}>
              <strong>VPN/nettverk mistet.</strong>
              {" "}Kobler til på nytt… forsøk {reconnectAttempt}/{MAX_RECONNECT_ATTEMPTS}
              {reconnectIn > 0 && ` — neste om ${reconnectIn}s`}
            </Text>
            <Tooltip title="Avbryt automatisk gjenoppkobling">
              <Button
                size="small"
                icon={<WifiOutlined />}
                onClick={cancelReconnect}
                style={{ marginLeft: 8 }}
              >
                Avbryt
              </Button>
            </Tooltip>
          </>
        )}
      </div>
    )}

    {/* LDIF dialogs */}
    <LdifExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    <LdifImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={refreshDitTree} />
    <CsvExportDialog  open={csvExportOpen} onClose={() => setCsvExportOpen(false)} />
    <UndoHistoryDrawer open={historyDrawerOpen} onClose={() => setHistoryDrawerOpen(false)} />
    <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </>
  );
};

export default Toolbar;
