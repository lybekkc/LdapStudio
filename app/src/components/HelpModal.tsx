import React, { useState } from "react";
import {
  Modal, Tabs, Typography, Table, Tag, Space, Collapse,
  Alert,
} from "antd";
import {
  ApartmentOutlined, SearchOutlined, DatabaseOutlined,
  DownloadOutlined, UploadOutlined, ApiOutlined,
  LockOutlined, BulbOutlined,
} from "@ant-design/icons";

const { Title, Paragraph, Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
}

const isMac = navigator.platform.toUpperCase().includes("MAC");
const mod = isMac ? "⌘" : "Ctrl";

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────

const shortcuts = [
  { category: "Navigation", key: `${mod}+1`,  action: "Switch to Browser tab" },
  { category: "Navigation", key: `${mod}+2`,  action: "Switch to Search tab" },
  { category: "Navigation", key: `${mod}+3`,  action: "Switch to Schema tab" },
  { category: "Browser",    key: "F5",         action: "Refresh DIT tree" },
  { category: "Browser",    key: "?",          action: "Open keyboard shortcuts" },
  { category: "History",    key: `${mod}+Z`,   action: "Undo last operation" },
  { category: "History",    key: `${mod}+H`,   action: "Open operation history" },
  { category: "Entry",      key: `${mod}+E`,   action: "Edit selected entry" },
  { category: "Entry",      key: `${mod}+S`,   action: "Save changes (edit mode)" },
  { category: "Entry",      key: `${mod}+N`,   action: "New entry (Browser tab)" },
  { category: "Entry",      key: `${mod}+C`,   action: "Copy selected entry to clipboard" },
  { category: "Entry",      key: `${mod}+V`,   action: "Paste entry (opens New Entry drawer pre-filled)" },
  { category: "Entry",      key: "Escape",     action: "Cancel edit mode" },
];

const CATEGORY_COLORS: Record<string, string> = {
  Navigation: "blue",
  Browser:    "cyan",
  History:    "purple",
  Entry:      "orange",
};

const Section: React.FC<{ title: React.ReactNode; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ marginBottom: 20 }}>
    <Title level={5} style={{ marginBottom: 6 }}>{title}</Title>
    {children}
  </div>
);

const Tip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Alert type="info" showIcon style={{ marginBottom: 8, fontSize: 12 }} message={children} />
);

const kv = (key: string, val: React.ReactNode) => (
  <div style={{ display: "flex", gap: 8, marginBottom: 4, fontSize: 13 }}>
    <Text strong style={{ minWidth: 140 }}>{key}</Text>
    <span style={{ color: "#555" }}>{val}</span>
  </div>
);

// ─── Tab content ──────────────────────────────────────────────────────────────

const GettingStarted: React.FC = () => (
  <Typography>
    <Section title="🔌 Connect to a server">
      <Paragraph style={{ fontSize: 13 }}>
        Click <Text strong>Connect</Text> in the toolbar to open the connection dialog.
        Fill in server details and choose an authentication method:
      </Paragraph>
      {kv("LDAP (plain)", "Port 389 — unencrypted")}
      {kv("LDAPS (TLS)", "Port 636 — encrypted, recommended for production")}
      {kv("StartTLS", "Port 389 — upgrades to encrypted")}
      {kv("Anonymous", "No login required")}
      {kv("Simple Bind", "DN + password")}
      {kv("SASL PLAIN", "SASL authentication")}
    </Section>

    <Section title="💾 Connection profiles">
      <Paragraph style={{ fontSize: 13 }}>
        Click <Text strong>Save Profile</Text> to save the connection. Saved profiles appear
        on the <Text italic>Saved Profiles</Text> tab and can be edited or deleted.
      </Paragraph>
    </Section>

    <Section title={<><LockOutlined style={{ marginRight: 4 }} />Read-only mode</>}>
      <Paragraph style={{ fontSize: 13 }}>
        Enable <Text strong>Read-only</Text> in the profile to block all write operations.
        Useful for production environments. Can be temporarily unlocked from the toolbar if needed.
      </Paragraph>
    </Section>

    <Section title="🎨 Profile colours">
      <Paragraph style={{ fontSize: 13 }}>
        Each connection name gets a unique colour in the toolbar — makes it easy to see
        which environment is active (e.g. DEV vs PROD) when multiple windows are open.
      </Paragraph>
    </Section>
  </Typography>
);

const BrowserHelp: React.FC = () => (
  <Typography>
    <Section title="🌲 Navigating the DIT tree">
      <Paragraph style={{ fontSize: 13 }}>
        The directory tree structure is shown on the left. Click an arrow to expand a node.
        Click a node name to view entry details on the right.
      </Paragraph>
      <Tip>Press <Text code>F5</Text> or click the ↺ button at the top of the tree to refresh.</Tip>
    </Section>

    <Section title="🖱️ Right-click menu">
      {kv("New entry", "Create a new entry under the selected node")}
      {kv("Rename / Move", "Change the RDN or move the entry to a new location")}
      {kv("Copy entry", "Save the entry to clipboard for pasting elsewhere")}
      {kv("Delete", "Delete the entry (with confirmation)")}
    </Section>

    <Section title="✏️ Editing an entry">
      <Paragraph style={{ fontSize: 13 }}>
        Press <Text code>{mod}+E</Text> or click the edit button in the entry details panel.
        Change attribute values and click <Text strong>Save</Text> or press <Text code>{mod}+S</Text>.
        Press <Text code>Escape</Text> to cancel without saving.
      </Paragraph>
      <Tip>Password attributes are never shown in plain text. Enter a new password to change it.</Tip>
    </Section>

    <Section title="↩️ Undo">
      <Paragraph style={{ fontSize: 13 }}>
        <Text code>{mod}+Z</Text> undoes the last write operation (modify, delete, add, rename).
        <Text code>{mod}+H</Text> opens the full history where you can undo older operations.
        History is stored per connection profile.
      </Paragraph>
    </Section>

    <Section title="📋 Clipboard">
      <Paragraph style={{ fontSize: 13 }}>
        <Text code>{mod}+C</Text> copies the selected entry (without sensitive attributes).
        <Text code>{mod}+V</Text> opens the New Entry drawer pre-filled with the copied data.
        Useful for duplicating entries.
      </Paragraph>
    </Section>
  </Typography>
);

const SearchHelp: React.FC = () => (
  <Typography>
    <Section title="🔍 Search filter">
      <Paragraph style={{ fontSize: 13 }}>
        Uses standard LDAP filter syntax (RFC 4515):
      </Paragraph>
      <Collapse size="small" ghost items={[
        {
          key: "examples",
          label: <Text strong style={{ fontSize: 12 }}>Filter examples</Text>,
          children: (
            <div style={{ fontSize: 12 }}>
              {[
                ["(cn=*)",                        "All entries with a cn attribute"],
                ["(cn=John*)",                    "cn starting with \"John\""],
                ["(mail=*@example.com)",           "All e-mails in the domain"],
                ["(objectClass=person)",           "All person entries"],
                ["(&(objectClass=person)(cn=*))",  "AND: person AND has cn"],
                ["(|(cn=John)(cn=Jane))",          "OR: cn is John or Jane"],
                ["(!(objectClass=computer))",      "NOT: not computer entries"],
              ].map(([f, d]) => (
                <div key={f} style={{ marginBottom: 4 }}>
                  <Text code style={{ fontSize: 11 }}>{f}</Text>
                  <Text type="secondary" style={{ marginLeft: 8 }}>{d}</Text>
                </div>
              ))}
            </div>
          ),
        },
      ]} />
    </Section>

    <Section title="📐 Search scope">
      {kv("Base",     "Only the entry at the given base DN")}
      {kv("One",      "Direct children of the base DN (one level down)")}
      {kv("Sub",      "The entire subtree under the base DN (default)")}
    </Section>

    <Section title="⭐ Saved searches">
      <Paragraph style={{ fontSize: 13 }}>
        Click the star icon (⭐) to save a search. Saved searches are linked to the
        connection profile — DEV and PROD have separate search lists.
      </Paragraph>
      <Paragraph style={{ fontSize: 13 }}>
        Click the pencil icon to edit the name, filter, base DN and scope of a saved search.
        An automatic name is generated if you don't enter one.
      </Paragraph>
    </Section>
  </Typography>
);

const SchemaHelp: React.FC = () => (
  <Typography>
    <Section title="📋 Object Classes and Attribute Types">
      <Paragraph style={{ fontSize: 13 }}>
        The Schema tab shows all object classes and attribute types defined on the server.
        Click a name to see details. Click ✏️ to edit the definition.
      </Paragraph>
    </Section>

    <Section title="🏷️ Custom OIDs">
      <Paragraph style={{ fontSize: 13 }}>
        OC/AT that don't belong to known standards (X.500, inetOrgPerson, OpenLDAP, etc.)
        are shown with an orange <Tag color="volcano" style={{ fontSize: 10 }}>custom</Tag> badge.
      </Paragraph>
      <Paragraph style={{ fontSize: 13 }}>
        Turn on the <Text strong>Custom only</Text> toggle to show only your own definitions.
      </Paragraph>
    </Section>

    <Section title={<><BulbOutlined style={{ color: "#faad14", marginRight: 4 }} />Enterprise base OID (PEN)</>}>
      <Paragraph style={{ fontSize: 13 }}>
        Set your IANA Private Enterprise Number (PEN) base OID in the connection profile.
        Then <Text strong>Custom only</Text> and <Text strong>custom</Text> badges will
        only apply to OIDs under your arc — not other third-party OIDs.
      </Paragraph>
      <Paragraph style={{ fontSize: 13 }}>
        The 💡 button next to the OID field when creating a new OC/AT automatically suggests
        the next available OID under your enterprise arc.
      </Paragraph>
      <Tip>
        Find your PEN number at{" "}
        <a href="https://www.iana.org/assignments/enterprise-numbers/" target="_blank" rel="noopener noreferrer">
          iana.org/assignments/enterprise-numbers
        </a>.
        Enter the full sub-arc, e.g. <Text code style={{ fontSize: 11 }}>1.3.6.1.4.1.12345.1.2</Text>.
      </Tip>
    </Section>

    <Section title="✏️ Editing the schema">
      <Paragraph style={{ fontSize: 13 }}>
        Requires write access to the schema entry on the server.
        Changes are saved via LDAP <Text code>modify</Text> and can be undone with <Text code>{mod}+Z</Text>.
      </Paragraph>
      <Alert
        type="warning" showIcon style={{ fontSize: 12 }}
        message="Deleting an OC/AT only removes the definition — entries that already use them are not immediately affected."
      />
    </Section>
  </Typography>
);

const ImportExportHelp: React.FC = () => (
  <Typography>
    <Section title={<><DownloadOutlined style={{ marginRight: 4 }} />LDIF Export</>}>
      <Paragraph style={{ fontSize: 13 }}>
        Export one entry or an entire subtree to LDIF format.
        Choose base DN and scope. The file can be imported to another server or used as a backup.
      </Paragraph>
      <Tip>Binary attributes (e.g. <Text code>jpegPhoto</Text>) are automatically base64-encoded.</Tip>
    </Section>

    <Section title={<><UploadOutlined style={{ marginRight: 4 }} />LDIF Import</>}>
      <Paragraph style={{ fontSize: 13 }}>
        Import from an LDIF file. Supports <Text code>changetype: add</Text>,{" "}
        <Text code>modify</Text> and <Text code>delete</Text>.
        Dry-run mode shows what would happen without making any changes.
      </Paragraph>
      <Paragraph style={{ fontSize: 13 }}>
        Results are shown per entry with error messages for any that fail.
      </Paragraph>
    </Section>

    <Section title="📊 CSV / Excel Export">
      <Paragraph style={{ fontSize: 13 }}>
        Export search results to CSV. Choose which attributes to include.
        The file opens directly in Excel or Numbers.
      </Paragraph>
    </Section>
  </Typography>
);

const ShortcutsHelp: React.FC = () => (
  <Table
    dataSource={shortcuts}
    rowKey="key"
    size="small"
    pagination={false}
    columns={[
      {
        title: "Category",
        dataIndex: "category",
        width: 110,
        render: (c: string) => <Tag color={CATEGORY_COLORS[c] ?? "default"}>{c}</Tag>,
      },
      {
        title: "Shortcut",
        dataIndex: "key",
        width: 140,
        render: (k: string) => <Text code style={{ fontSize: 12 }}>{k}</Text>,
      },
      {
        title: "Action",
        dataIndex: "action",
        render: (a: string) => <Text style={{ fontSize: 12 }}>{a}</Text>,
      },
    ]}
  />
);

// ─── Main modal ───────────────────────────────────────────────────────────────

const tabItems = [
  {
    key: "start",
    label: <Space><ApiOutlined />Getting started</Space>,
    children: <GettingStarted />,
  },
  {
    key: "browser",
    label: <Space><ApartmentOutlined />Browser</Space>,
    children: <BrowserHelp />,
  },
  {
    key: "search",
    label: <Space><SearchOutlined />Search</Space>,
    children: <SearchHelp />,
  },
  {
    key: "schema",
    label: <Space><DatabaseOutlined />Schema</Space>,
    children: <SchemaHelp />,
  },
  {
    key: "importexport",
    label: <Space><DownloadOutlined />Import/Export</Space>,
    children: <ImportExportHelp />,
  },
  {
    key: "shortcuts",
    label: "⌨️ Shortcuts",
    children: <ShortcutsHelp />,
  },
];

const HelpModal: React.FC<Props> = ({ open, onClose }) => {
  const [activeTab, setActiveTab] = useState("start");

  return (
    <Modal
      open={open}
      title="📖 LDAP Studio — Help"
      onCancel={onClose}
      footer={null}
      width={720}
      styles={{ body: { padding: "0 24px 24px" } }}
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
        style={{ minHeight: 460 }}
        tabPosition="left"
        size="small"
      />
    </Modal>
  );
};

export default HelpModal;

