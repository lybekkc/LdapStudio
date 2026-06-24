import React, { useState, useEffect } from "react";
import { Button, Space, Tag, Tooltip, Typography, Popover, Drawer, Form, InputNumber, Switch, Divider, Modal, Badge, Select } from "antd";
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
import HelpModal from "./HelpModal";
import type { AppTab } from "../types";
import { LdapIcon } from "./LdapIcon";

const { Text } = Typography;

// Stable color per profile name — makes it easy to visually tell environments apart
const TAG_COLORS = ["cyan", "blue", "geekblue", "purple", "magenta", "red", "volcano", "orange", "gold", "lime", "green"];
function profileColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}

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
    dateFormat, setDateFormat,
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
  const [helpOpen,       setHelpOpen]       = useState(false);

  // Listen for global "show-shortcuts" event (triggered by "?" key)
  useEffect(() => {
    const handler = () => setShortcutsOpen(true);
    window.addEventListener("show-shortcuts", handler);
    return () => window.removeEventListener("show-shortcuts", handler);
  }, []);

  // F1 opens help
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F1") { e.preventDefault(); setHelpOpen(true); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Update window title to reflect the active profile
  useEffect(() => {
    if (connected && activeProfile) {
      document.title = `${activeProfile.name} — LDAP Studio`;
    } else {
      document.title = "LDAP Studio";
    }
  }, [connected, activeProfile]);

  const handleUnlock = () => {
    Modal.confirm({
      title: "Enable write access?",
      icon: <UnlockOutlined style={{ color: "#fa8c16" }} />,
      content: (
        <div>
          <p>You are about to enable write access for:</p>
          <p><strong>{activeProfile?.name}</strong> ({activeProfile?.host})</p>
          <p style={{ color: "#d4380d" }}>
            ⚠️ This connection is marked as <strong>read-only</strong>. Be careful with changes!
          </p>
        </div>
      ),
      okText: "Unlock",
      okButtonProps: { danger: true },
      cancelText: "Cancel",
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
      {activeProfile && (
        <div style={{ marginBottom: 6 }}>
          <Text type="secondary">Profile:</Text>{" "}
          <Tag color={profileColor(activeProfile.name)} style={{ fontWeight: 600 }}>{activeProfile.name}</Tag>
        </div>
      )}
      {activeProfile && (
        <div><Text type="secondary">Host:</Text> {activeProfile.host}:{activeProfile.port}</div>
      )}
      <div><Text type="secondary">Active base DN:</Text> <Text code style={{ fontSize: 11 }}>{serverInfo.activeBaseDn}</Text></div>
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
            title={nc === serverInfo.activeBaseDn ? "Active base DN" : "Click to switch to this"}
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
          <Tooltip title="Export to LDIF">
            <Button type="text" size="small" icon={<DownloadOutlined />}
              onClick={() => setExportOpen(true)} style={{ color: "#ffffffaa" }} />
          </Tooltip>
          <Tooltip title="Export to CSV / Excel">
            <Button type="text" size="small" icon={<TableOutlined />}
              onClick={() => setCsvExportOpen(true)} style={{ color: "#ffffffaa" }} />
          </Tooltip>
          <Tooltip title="Import from LDIF">
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
      <Tooltip title="Settings">
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

      {/* Help */}
      <Tooltip title="Help (F1)">
        <Button
          type="text"
          icon={<span style={{ fontSize: 14 }}>📖</span>}
          onClick={() => setHelpOpen(true)}
          style={{ color: "#ffffffaa" }}
        />
      </Tooltip>

      {/* Connection status */}
      {connected && serverInfo ? (
        <Space>
          {/* Read-only / write-unlocked indicator */}
          {activeProfile?.readOnly && (
            writeUnlocked ? (
              <Tooltip title="Write access active — click to lock again">
                <Tag
                  color="warning"
                  icon={<UnlockOutlined />}
                  style={{ cursor: "pointer" }}
                  onClick={() => setWriteUnlocked(false)}
                >
                  Write access active
                </Tag>
              </Tooltip>
            ) : (
              <Tooltip title="Read-only connection — click to temporarily unlock">
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

          {/* Profile name — colored badge, primary identity indicator */}
          {activeProfile && (
            <Tooltip title={`${activeProfile.host}:${activeProfile.port} — ${serverInfo.activeBaseDn}`}>
              <Tag
                color={profileColor(activeProfile.name)}
                style={{ fontWeight: 600, fontSize: 12, cursor: "default", userSelect: "none" }}
              >
                {activeProfile.name}
              </Tag>
            </Tooltip>
          )}

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
        title={<span><SettingOutlined style={{ marginRight: 8 }} />Settings</span>}
        placement="right"
        width={320}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      >
        <Form layout="vertical" size="small">

          <Divider orientation="left" style={{ fontSize: 12, color: "#888" }}>Search & Navigation</Divider>

          <Form.Item label="Results per page (paging)">
            <InputNumber
              min={10}
              max={10000}
              step={50}
              value={pageSize}
              onChange={(v) => { if (v && v > 0) setPageSize(v); }}
              style={{ width: "100%" }}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>
              Used for both search results and the DIT tree
            </Text>
          </Form.Item>

          <Divider orientation="left" style={{ fontSize: 12, color: "#888" }}>Object Class display</Divider>

          <Form.Item>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <TagsOutlined style={{ color: "#1677ff" }} />
                <span>Show in Browser tree</span>
              </span>
              <Switch checked={showOcBrowser} onChange={setShowOcBrowser} />
            </div>
            <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 4 }}>
              Shows object class tags next to each node in the DIT tree
            </Text>
          </Form.Item>

          <Form.Item>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <TagsOutlined style={{ color: "#1677ff" }} />
                <span>Show in Search results</span>
              </span>
              <Switch checked={showOcSearch} onChange={setShowOcSearch} />
            </div>
            <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 4 }}>
              Shows object class tags in the search results list
            </Text>
          </Form.Item>

          <Divider orientation="left" style={{ fontSize: 12, color: "#888" }}>Date & Time</Divider>

          <Form.Item label="Date display format">
            <Select
              value={dateFormat}
              onChange={setDateFormat}
              style={{ width: "100%" }}
              options={[
                { value: "DD.MM.YYYY HH:mm:ss", label: "DD.MM.YYYY HH:mm:ss (Norwegian)" },
                { value: "YYYY-MM-DD HH:mm:ss", label: "YYYY-MM-DD HH:mm:ss (ISO)" },
                { value: "MM/DD/YYYY HH:mm:ss", label: "MM/DD/YYYY HH:mm:ss (US)" },
                { value: "DD.MM.YYYY", label: "DD.MM.YYYY (date only)" },
                { value: "YYYY-MM-DD", label: "YYYY-MM-DD (date only, ISO)" },
              ]}
            />
            <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 4 }}>
              Shown next to raw LDAP timestamps in entry details
            </Text>
          </Form.Item>

        </Form>

        <div style={{ marginTop: 24, padding: "12px", background: "#f6ffed", border: "1px solid #b7eb8f", borderRadius: 6 }}>
          <Text style={{ fontSize: 11, color: "#52c41a" }}>
            ✓ Settings are saved automatically
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
              Connection lost — could not reconnect automatically.
            </Text>
            <Button
              size="small"
              type="primary"
              icon={<ApiOutlined />}
              onClick={() => setShowConnectionDialog(true)}
              style={{ marginLeft: 8 }}
            >
              Connect manually
            </Button>
          </>
        ) : (
          <>
            <LoadingOutlined style={{ color: "#d46b08", fontSize: 14 }} spin />
            <Text style={{ fontSize: 12, color: "#d46b08" }}>
              <strong>VPN/network lost.</strong>
              {" "}Reconnecting… attempt {reconnectAttempt}/{MAX_RECONNECT_ATTEMPTS}
              {reconnectIn > 0 && ` — next in ${reconnectIn}s`}
            </Text>
            <Tooltip title="Cancel auto-reconnect">
              <Button
                size="small"
                icon={<WifiOutlined />}
                onClick={cancelReconnect}
                style={{ marginLeft: 8 }}
              >
                Cancel
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
    <HelpModal      open={helpOpen}      onClose={() => setHelpOpen(false)} />
    </>
  );
};

export default Toolbar;
