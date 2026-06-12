import React, { useState } from "react";
import {
  Drawer, Button, List, Tag, Typography, Space, Tooltip,
  Popconfirm, Alert, Empty, Badge,
} from "antd";
import {
  UndoOutlined, DeleteOutlined, ClearOutlined,
  EditOutlined, MinusCircleOutlined, PlusCircleOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../store/appStore";
import { message } from "antd";
import type { UndoRecord } from "../types";

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
}

const OP_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  modify: { color: "orange", icon: <EditOutlined />,        label: "Modified" },
  delete: { color: "red",    icon: <MinusCircleOutlined />, label: "Deleted"  },
  add:    { color: "green",  icon: <PlusCircleOutlined />,  label: "Created"  },
};

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function shortDn(dn: string): string {
  return dn.length > 60 ? "…" + dn.slice(-57) : dn;
}

const UndoHistoryDrawer: React.FC<Props> = ({ open, onClose }) => {
  const { undoHistory, performUndo, removeUndoRecord, clearUndoHistory, activeProfile } =
    useAppStore();
  const [undoing, setUndoing] = useState<string | null>(null);

  const handleUndo = async (record: UndoRecord) => {
    setUndoing(record.id);
    try {
      await performUndo(record.id);
      message.success(`Undid: ${record.description} on ${record.dn.split(",")[0]}`);
    } catch (e) {
      message.error(`Undo failed: ${e}`);
    } finally {
      setUndoing(null);
    }
  };

  const handleRemove = async (id: string) => {
    await removeUndoRecord(id);
  };

  return (
    <Drawer
      title={
        <Space>
          <UndoOutlined />
          <span>Operation History</span>
          {undoHistory.length > 0 && (
            <Badge count={undoHistory.length} color="#1677ff" />
          )}
        </Space>
      }
      placement="right"
      width={480}
      open={open}
      onClose={onClose}
      extra={
        undoHistory.length > 0 ? (
          <Popconfirm
            title="Clear all history?"
            description={`This will delete all ${undoHistory.length} records for ${activeProfile?.name}.`}
            onConfirm={clearUndoHistory}
            okText="Clear"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" icon={<ClearOutlined />} danger>
              Clear all
            </Button>
          </Popconfirm>
        ) : undefined
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12, fontSize: 12 }}
        message="History is stored per connection profile and survives restarts."
        description={
          <span>
            Undo re-applies the inverse operation against the live LDAP server.
            {" "}<strong>Best-effort:</strong> if others have changed the entry since,
            undo may overwrite their changes.
          </span>
        }
      />

      {undoHistory.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No operations recorded yet"
        />
      ) : (
        <List<UndoRecord>
          dataSource={undoHistory}
          size="small"
          renderItem={(record: UndoRecord) => {
            const cfg = OP_CONFIG[record.operationType] ?? OP_CONFIG.modify;
            const isUndoing = undoing === record.id;
            const canUndo = record.operationType !== "delete" || !!record.snapshot;

            return (
              <List.Item
                style={{
                  padding: "8px 4px",
                  borderBottom: "1px solid #f0f0f0",
                  alignItems: "flex-start",
                }}
                actions={[
                  <Tooltip
                    key="undo"
                    title={
                      !canUndo
                        ? "Cannot undo — entry snapshot not available"
                        : isUndoing
                        ? "Undoing…"
                        : "Undo this operation"
                    }
                  >
                    <Button
                      size="small"
                      icon={<UndoOutlined />}
                      loading={isUndoing}
                      disabled={!canUndo || undoing !== null}
                      onClick={() => handleUndo(record)}
                    >
                      Undo
                    </Button>
                  </Tooltip>,
                  <Tooltip key="remove" title="Remove from history (does not undo)">
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleRemove(record.id)}
                    />
                  </Tooltip>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space size={4} wrap>
                      <Tag color={cfg.color} icon={cfg.icon} style={{ margin: 0 }}>
                        {cfg.label}
                      </Tag>
                      <Text style={{ fontFamily: "monospace", fontSize: 11 }} title={record.dn}>
                        {shortDn(record.dn)}
                      </Text>
                    </Space>
                  }
                  description={
                    <div>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {formatTimestamp(record.timestamp)}
                      </Text>
                      {record.description && (
                        <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
                          — {record.description}
                        </Text>
                      )}
                      {record.hasRedactedAttrs && (
                        <div>
                          <Tag
                            icon={<WarningOutlined />}
                            color="warning"
                            style={{ fontSize: 10, marginTop: 2 }}
                          >
                            Password attributes excluded from snapshot
                          </Tag>
                        </div>
                      )}
                    </div>
                  }
                />
              </List.Item>
            );
          }}
        />
      )}
    </Drawer>
  );
};

export default UndoHistoryDrawer;


