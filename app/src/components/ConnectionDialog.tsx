import React, { useState, useEffect } from "react";
import {
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Button,
  Tabs,
  Table,
  Popconfirm,
  Alert,
  Space,
  Typography,
  Switch,
  Tooltip,
} from "antd";
import { PlusOutlined, DeleteOutlined, ApiOutlined, LockOutlined, EditOutlined } from "@ant-design/icons";
import { v4 as uuidv4 } from "uuid";
import { useAppStore } from "../store/appStore";
import type { AuthMethod, ConnectionProfile, ConnectionType } from "../types";

const { Text } = Typography;

interface FormValues {
  name: string;
  host: string;
  port: number;
  connectionType: ConnectionType;
  authKind: "ANONYMOUS" | "SIMPLE_BIND" | "SASL_PLAIN";
  bindDn?: string;
  password?: string;
  authzId?: string;
  baseDn?: string;
  timeoutSecs: number;
  readOnly: boolean;
  enterpriseBaseOid?: string;
}

function formToProfile(values: FormValues, id?: string): ConnectionProfile {
  let auth: AuthMethod;
  switch (values.authKind) {
    case "SIMPLE_BIND":
      auth = { kind: "SIMPLE_BIND", bind_dn: values.bindDn ?? "", password: values.password ?? "" };
      break;
    case "SASL_PLAIN":
      auth = { kind: "SASL_PLAIN", authz_id: values.authzId ?? "", password: values.password ?? "" };
      break;
    default:
      auth = { kind: "ANONYMOUS" };
  }

  return {
    id: id ?? uuidv4(),
    name: values.name,
    host: values.host,
    port: values.port,
    connectionType: values.connectionType,
    auth,
    baseDn: values.baseDn?.trim() || null,
    timeoutSecs: values.timeoutSecs,
    readOnly: values.readOnly,
    enterpriseBaseOid: values.enterpriseBaseOid?.trim() || undefined,
  };
}

function profileToForm(p: ConnectionProfile): FormValues {
  const base: Omit<FormValues, "authKind" | "bindDn" | "password" | "authzId"> = {
    name: p.name,
    host: p.host,
    port: p.port,
    connectionType: p.connectionType,
    baseDn: p.baseDn ?? "",
    timeoutSecs: p.timeoutSecs,
    readOnly: p.readOnly ?? false,
    enterpriseBaseOid: p.enterpriseBaseOid ?? "",
  };
  if (p.auth.kind === "SIMPLE_BIND") {
    return { ...base, authKind: "SIMPLE_BIND", bindDn: p.auth.bind_dn, password: p.auth.password };
  }
  if (p.auth.kind === "SASL_PLAIN") {
    return { ...base, authKind: "SASL_PLAIN", authzId: p.auth.authz_id, password: p.auth.password };
  }
  return { ...base, authKind: "ANONYMOUS" };
}

// ─── Connection Form (new / edit) ────────────────────────────────────────────

export interface ConnectionFormProps {
  initialValues?: ConnectionProfile;
  onSave: (p: ConnectionProfile) => void;
  onConnect: (p: ConnectionProfile) => void;
  loading: boolean;
}

export const ConnectionForm: React.FC<ConnectionFormProps> = ({ initialValues, onSave, onConnect, loading }) => {
  const [form] = Form.useForm<FormValues>();
  const authKind = Form.useWatch("authKind", form);
  const connectionType = Form.useWatch("connectionType", form);

  const defaultPort = connectionType === "LDAPS" ? 636 : 389;

  const handleConnect = async () => {
    const values = await form.validateFields();
    const profile = formToProfile(values, initialValues?.id);
    onConnect(profile);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    const profile = formToProfile(values, initialValues?.id);
    onSave(profile);
  };

  const initVals = initialValues
    ? profileToForm(initialValues)
    : {
        name: "New Connection",
        host: "",
        port: 636,
        connectionType: "LDAPS" as ConnectionType,
        authKind: "SIMPLE_BIND" as const,
        timeoutSecs: 15,
        readOnly: false,
      };

  return (
    <Form form={form} layout="vertical" initialValues={initVals} style={{ maxWidth: 520 }}>
      <Form.Item name="name" label="Profile name" rules={[{ required: true }]}>
        <Input placeholder="My LDAP Server" />
      </Form.Item>

      <Form.Item label="Server" style={{ marginBottom: 0 }}>
        <Space.Compact style={{ width: "100%" }}>
          <Form.Item name="host" noStyle rules={[{ required: true, message: "Host required" }]}>
            <Input style={{ width: "70%" }} placeholder="ldap.example.com" />
          </Form.Item>
          <Form.Item name="port" noStyle>
            <InputNumber style={{ width: "30%" }} min={1} max={65535} placeholder={String(defaultPort)} />
          </Form.Item>
        </Space.Compact>
      </Form.Item>

      <Form.Item name="connectionType" label="Connection type">
        <Select
          options={[
            { value: "PLAIN",     label: "LDAP (plain, port 389)" },
            { value: "LDAPS",     label: "LDAPS (TLS, port 636)" },
            { value: "START_TLS", label: "StartTLS (upgrade plain)" },
          ]}
        />
      </Form.Item>

      <Form.Item name="authKind" label="Authentication">
        <Select
          options={[
            { value: "ANONYMOUS",   label: "Anonymous" },
            { value: "SIMPLE_BIND", label: "Simple Bind (DN + Password)" },
            { value: "SASL_PLAIN",  label: "SASL PLAIN" },
          ]}
        />
      </Form.Item>

      {(authKind === "SIMPLE_BIND") && (
        <Form.Item name="bindDn" label="Bind DN" rules={[{ required: true }]}>
          <Input placeholder="cn=Directory Manager,dc=example,dc=com" />
        </Form.Item>
      )}

      {(authKind === "SASL_PLAIN") && (
        <Form.Item name="authzId" label="Authorization ID" rules={[{ required: true }]}>
          <Input placeholder="uid=admin,dc=example,dc=com" />
        </Form.Item>
      )}

      {(authKind === "SIMPLE_BIND" || authKind === "SASL_PLAIN") && (
        <Form.Item name="password" label="Password" rules={[{ required: true }]}>
          <Input.Password />
        </Form.Item>
      )}

      <Form.Item name="baseDn" label={<span>Base DN <Text type="secondary">(leave blank to auto-detect)</Text></span>}>
        <Input placeholder="dc=example,dc=com" />
      </Form.Item>

      <Form.Item
        name="enterpriseBaseOid"
        label={
          <span>
            Enterprise base OID{" "}
            <Text type="secondary">(your IANA PEN prefix)</Text>
          </span>
        }
        validateTrigger="onBlur"
        extra={
          <div style={{ fontSize: 11, color: "#888", lineHeight: 1.6 }}>
            <div style={{ marginBottom: 4 }}>
              Enter the OID prefix that is the <strong>root of all your custom schema</strong>.
              All object classes and attributes whose OID <em>starts with</em> this prefix
              will be treated as custom.
            </div>
            <div style={{ marginBottom: 4 }}>
              <Text strong style={{ fontSize: 11 }}>Example breakdown:</Text>
              <div style={{ fontFamily: "monospace", fontSize: 11, marginTop: 2, color: "#555" }}>
                <Text code style={{ fontSize: 10 }}>1.3.6.1.4.1</Text>
                <Text type="secondary" style={{ fontSize: 10 }}> — IANA enterprises arc</Text>
                <br />
                <Text code style={{ fontSize: 10 }}>1.3.6.1.4.1.<strong>53391</strong></Text>
                <Text type="secondary" style={{ fontSize: 10 }}> — your PEN (enter this as a minimum)</Text>
                <br />
                <Text code style={{ fontSize: 10 }}>1.3.6.1.4.1.53391<strong>.1.2</strong></Text>
                <Text type="secondary" style={{ fontSize: 10 }}> — optional sub-arc for more precision</Text>
              </div>
            </div>
            <div>
              💡 <strong>Tip:</strong> Start with just{" "}
              <Text code style={{ fontSize: 10 }}>1.3.6.1.4.1.NNNNN</Text>
              {" "}(your PEN number). You can refine it to a sub-arc later if needed.
              Find your PEN at{" "}
              <a href="https://www.iana.org/assignments/enterprise-numbers/" target="_blank" rel="noopener noreferrer">
                IANA Enterprise Numbers ↗
              </a>
            </div>
          </div>
        }
        rules={[{
          pattern: /^[0-9]+(\.[0-9]+)*$/,
          message: "Invalid OID format — use only numbers and dots, e.g. 1.3.6.1.4.1.53391",
        }]}
      >
        <Input
          placeholder="1.3.6.1.4.1.53391"
          style={{ fontFamily: "monospace" }}
        />
      </Form.Item>

      <Form.Item name="timeoutSecs" label="Timeout (seconds)">
        <InputNumber min={3} max={120} />
      </Form.Item>

      <Form.Item
        name="readOnly"
        valuePropName="checked"
        label={
          <span>
            <LockOutlined style={{ marginRight: 6, color: "#722ed1" }} />
            Read-only (write-protected)
          </span>
        }
        extra={
          <Text type="secondary" style={{ fontSize: 11 }}>
            Blocks all write operations. Can be temporarily unlocked from the toolbar.
            Useful for production environments.
          </Text>
        }
      >
        <Switch />
      </Form.Item>

      <Form.Item>
        <Space>
          <Button type="primary" icon={<ApiOutlined />} loading={loading} onClick={handleConnect}>
            Connect
          </Button>
          <Button onClick={handleSave}>Save Profile</Button>
        </Space>
      </Form.Item>
    </Form>
  );
};

// ─── Main Connection Dialog ──────────────────────────────────────────────────

const ConnectionDialog: React.FC = () => {
  const {
    showConnectionDialog,
    profiles,
    connecting,
    connectionError,
    connected,
    connectToServer,
    saveProfile,
    removeProfile,
    setShowConnectionDialog,
  } = useAppStore();

  const [editingProfile, setEditingProfile] = useState<ConnectionProfile | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<string>("new");
  const [tabInitialized, setTabInitialized] = useState(false);

  // Switch to profiles tab once profiles are loaded (async from storage)
  useEffect(() => {
    if (!showConnectionDialog) {
      setTabInitialized(false);
      return;
    }
    if (!tabInitialized && profiles.length > 0) {
      setActiveTab("profiles");
      setTabInitialized(true);
    }
  }, [showConnectionDialog, profiles.length, tabInitialized]);

  const profileColumns = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      render: (text: string, record: ConnectionProfile) => (
        <span>
          {record.readOnly && (
            <Tooltip title="Read-only profile">
              <LockOutlined style={{ color: "#722ed1", marginRight: 6, fontSize: 11 }} />
            </Tooltip>
          )}
          <Text strong style={{ fontSize: 13 }}>{text}</Text>
        </span>
      ),
    },
    {
      title: "Host",
      render: (_: unknown, r: ConnectionProfile) => (
        <Text type="secondary" style={{ fontSize: 12 }}>{r.host}:{r.port}</Text>
      ),
    },
    {
      title: "Type",
      dataIndex: "connectionType",
      key: "connectionType",
      render: (t: string) => <Text type="secondary" style={{ fontSize: 12 }}>{t}</Text>,
    },
    {
      title: "",
      key: "actions",
      width: 150,
      render: (_: unknown, record: ConnectionProfile) => (
        <Space>
          <Tooltip title="Connect">
            <Button
              type="primary"
              size="small"
              icon={<ApiOutlined />}
              onClick={() => connectToServer(record)}
              loading={connecting}
            >
              Connect
            </Button>
          </Tooltip>
          <Tooltip title="Edit profile">
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => setEditingProfile(record)}
            />
          </Tooltip>
          <Tooltip title="Delete profile">
            <Popconfirm
              title="Delete this profile?"
              okText="Delete"
              okType="danger"
              cancelText="Cancel"
              onConfirm={() => removeProfile(record.id)}
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Tooltip>
        </Space>
      ),
    },
  ];

  const tabItems = [
    {
      key: "new",
      label: (
        <span>
          <PlusOutlined /> New Connection
        </span>
      ),
      children: (
        <ConnectionForm
          onSave={async (p) => { await saveProfile(p); }}
          onConnect={connectToServer}
          loading={connecting}
        />
      ),
    },
    {
      key: "profiles",
      label: `Saved Profiles (${profiles.length})`,
      children: editingProfile ? (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <Button size="small" icon={<EditOutlined />} onClick={() => setEditingProfile(undefined)}>
              ← Back to list
            </Button>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Editing: <strong>{editingProfile.name}</strong>
            </Text>
          </div>
          <ConnectionForm
            initialValues={editingProfile}
            onSave={async (p) => { await saveProfile(p); setEditingProfile(undefined); }}
            onConnect={connectToServer}
            loading={connecting}
          />
        </div>
      ) : (
        <Table
          dataSource={profiles}
          columns={profileColumns}
          rowKey="id"
          pagination={false}
          size="small"
        />
      ),
    },
  ];

  return (
    <Modal
      open={showConnectionDialog}
      title="Connect to LDAP Server"
      footer={null}
      width={640}
      onCancel={() => { if (connected) setShowConnectionDialog(false); }}
      closable={connected}
      maskClosable={false}
    >
      {connectionError && (
        <Alert
          type="error"
          message="Connection failed"
          description={connectionError}
          showIcon
          closable
          style={{ marginBottom: 16 }}
        />
      )}
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
    </Modal>
  );
};

export default ConnectionDialog;
