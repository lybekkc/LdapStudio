import React, { useEffect, useRef } from "react";
import { Button, Tag, Tooltip, Typography } from "antd";
import {
  SearchOutlined, EditOutlined, DeleteOutlined,
  ClearOutlined, DownOutlined, UpOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../store/appStore";
import type { SearchLogEntry, ModLogEntry } from "../types";

const { Text } = Typography;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return iso.replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function scopeLabel(scope: string) {
  return scope === "base" ? "baseObject" : scope === "one" ? "singleLevel" : "wholeSubtree";
}

// ─── Search log entry ─────────────────────────────────────────────────────────

const SearchLogItem: React.FC<{ entry: SearchLogEntry }> = ({ entry }) => {
  const ok = !entry.error;
  return (
    <div style={{
      padding: "5px 12px",
      borderBottom: "1px solid #f0f0f0",
      fontFamily: "monospace",
      fontSize: 11,
      lineHeight: 1.6,
    }}>
      <div style={{ color: "#888" }}>#!DATE {fmtDate(entry.timestamp)}</div>
      {ok ? (
        <div style={{ color: "#389e0d", fontWeight: 600 }}>
          #!RESULT OK — {entry.resultCount ?? 0} entries{entry.durationMs !== undefined ? ` (${entry.durationMs}ms)` : ""}
        </div>
      ) : (
        <div style={{ color: "#cf1322", fontWeight: 600 }}>
          #!RESULT ERROR — {entry.error}
        </div>
      )}
      <div>
        <Text style={{ fontFamily: "monospace", fontSize: 11 }}>
          <span style={{ color: "#888" }}>base: </span>{entry.baseDn}
        </Text>
      </div>
      <div>
        <Text style={{ fontFamily: "monospace", fontSize: 11 }}>
          <span style={{ color: "#888" }}>filter: </span>
          <span style={{ color: "#1677ff" }}>{entry.filter}</span>
        </Text>
      </div>
      <div>
        <Text style={{ fontFamily: "monospace", fontSize: 11 }}>
          <span style={{ color: "#888" }}>scope: </span>{scopeLabel(entry.scope)}
        </Text>
      </div>
    </div>
  );
};

// ─── Modification log entry ───────────────────────────────────────────────────

const OP_COLOR: Record<string, string> = {
  add:    "#389e0d",
  modify: "#d46b08",
  delete: "#cf1322",
  rename: "#722ed1",
  schema: "#0958d9",
};

const ModLogItem: React.FC<{ entry: ModLogEntry }> = ({ entry }) => {
  const opColor = OP_COLOR[entry.operation] ?? "#333";
  return (
    <div style={{
      padding: "5px 12px",
      borderBottom: "1px solid #f0f0f0",
      fontFamily: "monospace",
      fontSize: 11,
      lineHeight: 1.6,
      background: entry.server ? "#fffbe6" : undefined,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "#888" }}>#!DATE {fmtDate(entry.timestamp)}</span>
        {entry.server && (
          <Tag color="purple" style={{ fontSize: 10, margin: 0 }}>⇢ {entry.server}</Tag>
        )}
      </div>
      {entry.success ? (
        <div style={{ color: "#389e0d", fontWeight: 600 }}>#!RESULT OK</div>
      ) : (
        <div style={{ color: "#cf1322", fontWeight: 600 }}>#!RESULT ERROR — {entry.error}</div>
      )}
      <div>
        <span style={{ color: "#888" }}>dn: </span>{entry.dn}
      </div>
      {entry.details.split("\n").map((line, i) => {
        const [key, ...rest] = line.split(": ");
        return (
          <div key={i}>
            <span style={{ color: "#888" }}>{key}: </span>
            <span style={{ color: opColor, fontWeight: key === "changetype" ? 600 : 400 }}>
              {rest.join(": ")}
            </span>
          </div>
        );
      })}
    </div>
  );
};

// ─── LogPanel ─────────────────────────────────────────────────────────────────

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 600;

const LogPanel: React.FC = () => {
  const {
    searchLogs, modLogs,
    logPanelOpen, logPanelHeight, activeLogTab,
    setLogPanelOpen, setLogPanelHeight, setActiveLogTab,
    clearSearchLogs, clearModLogs,
  } = useAppStore();

  const scrollRef    = useRef<HTMLDivElement>(null);
  const dragging     = useRef(false);
  const dragStartY   = useRef(0);
  const dragStartH   = useRef(0);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (logPanelOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [searchLogs, modLogs, logPanelOpen, activeLogTab]);

  // Auto-open panel when a new log entry arrives
  useEffect(() => {
    if (searchLogs.length > 0) {
      setLogPanelOpen(true);
      setActiveLogTab("search");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchLogs.length]);

  useEffect(() => {
    if (modLogs.length > 0) {
      setLogPanelOpen(true);
      setActiveLogTab("mod");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modLogs.length]);

  // Drag-to-resize handle
  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current   = true;
    dragStartY.current = e.clientY;
    dragStartH.current = logPanelHeight;
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = dragStartY.current - e.clientY;
      const newH  = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, dragStartH.current + delta));
      setLogPanelHeight(newH);
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabs: { key: "search" | "mod"; icon: React.ReactNode; label: string; count: number }[] = [
    { key: "search", icon: <SearchOutlined />, label: "Search Logs",       count: searchLogs.length },
    { key: "mod",    icon: <EditOutlined />,   label: "Modification Logs", count: modLogs.length    },
  ];

  const entries = activeLogTab === "search" ? searchLogs : modLogs;

  return (
    <div style={{ flexShrink: 0, borderTop: "1px solid #d9d9d9", background: "#fff" }}>

      {/* Drag handle */}
      {logPanelOpen && (
        <div
          onMouseDown={onMouseDown}
          style={{
            height: 4,
            cursor: "ns-resize",
            background: "transparent",
            borderTop: "2px solid transparent",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderTopColor = "#1677ff")}
          onMouseLeave={(e) => (e.currentTarget.style.borderTopColor = "transparent")}
        />
      )}

      {/* Header bar with tabs */}
      <div style={{
        display: "flex",
        alignItems: "center",
        height: 30,
        background: "#fafafa",
        borderBottom: logPanelOpen ? "1px solid #f0f0f0" : "none",
        paddingLeft: 4,
        gap: 0,
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              if (activeLogTab === tab.key && logPanelOpen) {
                setLogPanelOpen(false);
              } else {
                setActiveLogTab(tab.key);
                setLogPanelOpen(true);
              }
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "0 12px",
              height: 30,
              border: "none",
              borderRight: "1px solid #f0f0f0",
              background: activeLogTab === tab.key && logPanelOpen ? "#fff" : "transparent",
              borderBottom: activeLogTab === tab.key && logPanelOpen ? "2px solid #1677ff" : "2px solid transparent",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: activeLogTab === tab.key && logPanelOpen ? 600 : 400,
              color: "#333",
            }}
          >
            {tab.icon}
            {tab.label}
            {tab.count > 0 && (
              <span style={{
                background: "#1677ff", color: "#fff",
                borderRadius: 10, fontSize: 10,
                padding: "0 5px", lineHeight: "16px",
                minWidth: 16, textAlign: "center",
              }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}

        <div style={{ flex: 1 }} />

        {logPanelOpen && (
          <Tooltip title={`Clear ${activeLogTab === "search" ? "search" : "modification"} logs`}>
            <Button
              type="text" size="small"
              icon={<DeleteOutlined />}
              onClick={() => activeLogTab === "search" ? clearSearchLogs() : clearModLogs()}
              style={{ color: "#888", height: 24 }}
            />
          </Tooltip>
        )}

        <Tooltip title={logPanelOpen ? "Collapse log panel" : "Expand log panel"}>
          <Button
            type="text" size="small"
            icon={logPanelOpen ? <DownOutlined /> : <UpOutlined />}
            onClick={() => setLogPanelOpen(!logPanelOpen)}
            style={{ color: "#888", height: 24, marginRight: 4 }}
          />
        </Tooltip>
      </div>

      {/* Log content */}
      {logPanelOpen && (
        <div
          ref={scrollRef}
          style={{ height: logPanelHeight, overflowY: "auto", overflowX: "hidden" }}
        >
          {entries.length === 0 ? (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              height: "100%", color: "#bbb", fontSize: 12, fontStyle: "italic",
            }}>
              <ClearOutlined style={{ marginRight: 6 }} />
              No log entries yet
            </div>
          ) : (
            [...entries].reverse().map((entry) =>
              activeLogTab === "search"
                ? <SearchLogItem key={entry.id} entry={entry as SearchLogEntry} />
                : <ModLogItem    key={entry.id} entry={entry as ModLogEntry} />
            )
          )}
        </div>
      )}
    </div>
  );
};

export default LogPanel;
