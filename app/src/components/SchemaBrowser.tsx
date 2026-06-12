import React, { useEffect, useState } from "react";
import { Tabs, Table, Input, Tag, Spin, Empty, Descriptions, Drawer, Typography, Button, Tooltip } from "antd";
import { PlusOutlined, EditOutlined, ReloadOutlined } from "@ant-design/icons";
import { useAppStore } from "../store/appStore";
import { OcEditor, AtEditor } from "./SchemaEditor";
import type { AttributeType, ObjectClass } from "../types";

const { Search } = Input;
const { Text } = Typography;

// ─── Schema DN detection ─────────────────────────────────────────────────────

async function detectSchemaDn(): Promise<string> {
  // The schema DN is available via the subschemaSubentry in rootDSE.
  // Since we already load the schema, we know it exists — default fallback:
  return "cn=schema";
}

// ─── Object Classes tab ──────────────────────────────────────────────────────

const kindColors: Record<string, string> = {
  STRUCTURAL: "blue",
  AUXILIARY: "purple",
  ABSTRACT: "default",
};

interface OcTabProps {
  filter: string;
  schemaDn: string;
  readOnly: boolean;
  onEdit: (oc: ObjectClass) => void;
  onNew: () => void;
}

const ObjectClassesTab: React.FC<OcTabProps> = ({ filter, readOnly, onEdit, onNew }) => {
  const schema = useAppStore((s) => s.schema);
  const [selected, setSelected] = useState<ObjectClass | null>(null);

  if (!schema) return null;

  const filtered = schema.objectClasses.filter(
    (oc) =>
      !filter ||
      oc.name.toLowerCase().includes(filter.toLowerCase()) ||
      oc.oid.includes(filter)
  );

  const columns = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      sorter: (a: ObjectClass, b: ObjectClass) => a.name.localeCompare(b.name),
      render: (name: string, record: ObjectClass) => (
        <a onClick={() => setSelected(record)}>{name || record.oid}</a>
      ),
    },
    {
      title: "OID",
      dataIndex: "oid",
      key: "oid",
      width: 200,
      render: (oid: string) => <Text code style={{ fontSize: 11 }}>{oid}</Text>,
    },
    {
      title: "Kind",
      dataIndex: "kind",
      key: "kind",
      width: 110,
      filters: [
        { text: "STRUCTURAL", value: "STRUCTURAL" },
        { text: "AUXILIARY",  value: "AUXILIARY" },
        { text: "ABSTRACT",   value: "ABSTRACT" },
      ],
      onFilter: (value: unknown, record: ObjectClass) => record.kind === value,
      render: (kind: string) => <Tag color={kindColors[kind]}>{kind}</Tag>,
    },
    {
      title: "SUP",
      key: "sup",
      width: 140,
      render: (_: unknown, r: ObjectClass) => r.superior.join(", "),
    },
    {
      title: "Description",
      dataIndex: "description",
      key: "description",
      ellipsis: true,
    },
    {
      title: "",
      key: "actions",
      width: 60,
      render: (_: unknown, record: ObjectClass) => (
        !readOnly ? (
          <Tooltip title="Rediger definisjon">
            <Button size="small" icon={<EditOutlined />} onClick={() => onEdit(record)} />
          </Tooltip>
        ) : null
      ),
    },
  ];

  return (
    <>
      {!readOnly && (
        <div style={{ marginBottom: 8, display: "flex", justifyContent: "flex-end" }}>
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={onNew}>
            Ny ObjectClass
          </Button>
        </div>
      )}
      <Table<ObjectClass>
        dataSource={filtered}
        columns={columns}
        rowKey={(r) => r.oid || r.name}
        size="small"
        pagination={{ pageSize: 50, showSizeChanger: true }}
        showSorterTooltip={false}
        style={{ fontSize: 12 }}
      />

      {/* Detail drawer */}
      <Drawer
        title={selected?.name || selected?.oid}
        placement="right"
        width={480}
        open={!!selected}
        onClose={() => setSelected(null)}
        extra={!readOnly && (
          <Button size="small" icon={<EditOutlined />} onClick={() => { onEdit(selected!); setSelected(null); }}>
            Rediger
          </Button>
        )}
      >
        {selected && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="OID">{selected.oid}</Descriptions.Item>
            <Descriptions.Item label="Names">{selected.names.join(", ")}</Descriptions.Item>
            <Descriptions.Item label="Kind">
              <Tag color={kindColors[selected.kind]}>{selected.kind}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="SUP">{selected.superior.join(", ") || "—"}</Descriptions.Item>
            <Descriptions.Item label="Description">{selected.description || "—"}</Descriptions.Item>
            <Descriptions.Item label="MUST (required)">
              {selected.mustAttrs.length ? selected.mustAttrs.map((a) => <Tag key={a}>{a}</Tag>) : "—"}
            </Descriptions.Item>
            <Descriptions.Item label="MAY (optional)">
              {selected.mayAttrs.length ? selected.mayAttrs.map((a) => <Tag key={a}>{a}</Tag>) : "—"}
            </Descriptions.Item>
            {selected.raw && (
              <Descriptions.Item label="Raw">
                <Text code style={{ fontSize: 10, wordBreak: "break-all" }}>{selected.raw}</Text>
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Drawer>
    </>
  );
};

// ─── Attribute Types tab ─────────────────────────────────────────────────────

interface AtTabProps {
  filter: string;
  schemaDn: string;
  readOnly: boolean;
  onEdit: (at: AttributeType) => void;
  onNew: () => void;
}

const AttributeTypesTab: React.FC<AtTabProps> = ({ filter, readOnly, onEdit, onNew }) => {
  const schema = useAppStore((s) => s.schema);
  const [selected, setSelected] = useState<AttributeType | null>(null);

  if (!schema) return null;

  const filtered = schema.attributeTypes.filter(
    (at) =>
      !filter ||
      at.name.toLowerCase().includes(filter.toLowerCase()) ||
      at.oid.includes(filter)
  );

  const columns = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      sorter: (a: AttributeType, b: AttributeType) => a.name.localeCompare(b.name),
      render: (name: string, record: AttributeType) => (
        <a onClick={() => setSelected(record)}>{name || record.oid}</a>
      ),
    },
    {
      title: "OID",
      dataIndex: "oid",
      key: "oid",
      width: 200,
      render: (oid: string) => <Text code style={{ fontSize: 11 }}>{oid}</Text>,
    },
    {
      title: "Syntax",
      dataIndex: "syntax",
      key: "syntax",
      width: 200,
      ellipsis: true,
      render: (v: string | null) =>
        v ? <Text code style={{ fontSize: 11 }}>{v}</Text> : "—",
    },
    {
      title: "Single",
      dataIndex: "singleValue",
      key: "singleValue",
      width: 70,
      render: (v: boolean) => (v ? <Tag color="orange">Single</Tag> : null),
    },
    {
      title: "Usage",
      dataIndex: "usage",
      key: "usage",
      width: 150,
      render: (u: string) =>
        u !== "userApplications" ? <Tag color="geekblue">{u}</Tag> : null,
    },
    {
      title: "Description",
      dataIndex: "description",
      key: "description",
      ellipsis: true,
    },
    {
      title: "",
      key: "actions",
      width: 60,
      render: (_: unknown, record: AttributeType) => (
        !readOnly ? (
          <Tooltip title="Rediger definisjon">
            <Button size="small" icon={<EditOutlined />} onClick={() => onEdit(record)} />
          </Tooltip>
        ) : null
      ),
    },
  ];

  return (
    <>
      {!readOnly && (
        <div style={{ marginBottom: 8, display: "flex", justifyContent: "flex-end" }}>
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={onNew}>
            Ny AttributeType
          </Button>
        </div>
      )}
      <Table<AttributeType>
        dataSource={filtered}
        columns={columns}
        rowKey={(r) => r.oid || r.name}
        size="small"
        pagination={{ pageSize: 50, showSizeChanger: true }}
        showSorterTooltip={false}
        style={{ fontSize: 12 }}
      />

      <Drawer
        title={selected?.name || selected?.oid}
        placement="right"
        width={480}
        open={!!selected}
        onClose={() => setSelected(null)}
        extra={!readOnly && (
          <Button size="small" icon={<EditOutlined />} onClick={() => { onEdit(selected!); setSelected(null); }}>
            Rediger
          </Button>
        )}
      >
        {selected && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="OID">{selected.oid}</Descriptions.Item>
            <Descriptions.Item label="Names">{selected.names.join(", ")}</Descriptions.Item>
            <Descriptions.Item label="SUP">{selected.superior ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="Syntax">{selected.syntax ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="Equality">{selected.equality ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="Ordering">{selected.ordering ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="Substr">{selected.substr ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="Single-Value">{selected.singleValue ? "Yes" : "No"}</Descriptions.Item>
            <Descriptions.Item label="Collective">{selected.collective ? "Yes" : "No"}</Descriptions.Item>
            <Descriptions.Item label="No-User-Modification">{selected.noUserModification ? "Yes" : "No"}</Descriptions.Item>
            <Descriptions.Item label="Usage">{selected.usage}</Descriptions.Item>
            <Descriptions.Item label="Description">{selected.description || "—"}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </>
  );
};

// ─── Main Schema Browser ─────────────────────────────────────────────────────

const SchemaBrowser: React.FC = () => {
  const { schema, schemaLoading, loadSchema, reloadSchema, connected,
          activeProfile, writeUnlocked } = useAppStore();
  const [filter, setFilter] = useState("");
  const [schemaDn, setSchemaDn] = useState("cn=schema");

  // Editing state
  const [ocEditorOpen, setOcEditorOpen] = useState(false);
  const [ocEditing,    setOcEditing]    = useState<ObjectClass | null>(null); // null = new
  const [atEditorOpen, setAtEditorOpen] = useState(false);
  const [atEditing,    setAtEditing]    = useState<AttributeType | null>(null);

  const isReadOnly = (activeProfile?.readOnly === true) && !writeUnlocked;

  useEffect(() => {
    if (connected) {
      loadSchema();
      detectSchemaDn().then(setSchemaDn);
    }
  }, [connected, loadSchema]);

  const handleSaved = async () => {
    setOcEditorOpen(false);
    setAtEditorOpen(false);
    await reloadSchema();
  };

  if (!connected) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Not connected" style={{ marginTop: 80 }} />;
  }

  if (schemaLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 300 }}>
        <Spin tip="Loading schema…" />
      </div>
    );
  }

  if (!schema) return null;

  const tabItems = [
    {
      key: "oc",
      label: `Object Classes (${schema.objectClasses.length})`,
      children: (
        <ObjectClassesTab
          filter={filter}
          schemaDn={schemaDn}
          readOnly={isReadOnly}
          onEdit={oc => { setOcEditing(oc); setOcEditorOpen(true); }}
          onNew={() => { setOcEditing(null); setOcEditorOpen(true); }}
        />
      ),
    },
    {
      key: "at",
      label: `Attribute Types (${schema.attributeTypes.length})`,
      children: (
        <AttributeTypesTab
          filter={filter}
          schemaDn={schemaDn}
          readOnly={isReadOnly}
          onEdit={at => { setAtEditing(at); setAtEditorOpen(true); }}
          onNew={() => { setAtEditing(null); setAtEditorOpen(true); }}
        />
      ),
    },
    {
      key: "syn",
      label: `Syntaxes (${schema.ldapSyntaxes.length})`,
      children: (
        <Table
          dataSource={schema.ldapSyntaxes}
          columns={[
            { title: "OID", dataIndex: "oid", key: "oid", render: (v: string) => <Text code style={{ fontSize: 11 }}>{v}</Text> },
            { title: "Description", dataIndex: "description", key: "description" },
          ]}
          rowKey="oid"
          size="small"
          pagination={{ pageSize: 50 }}
        />
      ),
    },
    {
      key: "mr",
      label: `Matching Rules (${schema.matchingRules.length})`,
      children: (
        <Table
          dataSource={schema.matchingRules}
          columns={[
            { title: "Name", dataIndex: "name", key: "name" },
            { title: "OID", dataIndex: "oid", key: "oid", render: (v: string) => <Text code style={{ fontSize: 11 }}>{v}</Text> },
            { title: "Syntax OID", dataIndex: "syntaxOid", key: "syntaxOid", render: (v: string) => <Text code style={{ fontSize: 11 }}>{v}</Text> },
          ]}
          rowKey="oid"
          size="small"
          pagination={{ pageSize: 50 }}
        />
      ),
    },
  ];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "8px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Search
          placeholder="Filter by name or OID…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          allowClear
          style={{ maxWidth: 380 }}
        />
        <div style={{ flex: 1 }} />
        <Text type="secondary" style={{ fontSize: 11 }}>Schema DN:</Text>
        <Input
          size="small"
          value={schemaDn}
          onChange={e => setSchemaDn(e.target.value)}
          style={{ width: 200, fontFamily: "monospace", fontSize: 11 }}
        />
        <Tooltip title="Last inn schema på nytt">
          <Button size="small" icon={<ReloadOutlined />} onClick={reloadSchema} loading={schemaLoading}>
            Reload
          </Button>
        </Tooltip>
      </div>
      <Tabs items={tabItems} style={{ flex: 1 }} />

      {/* Editors */}
      <OcEditor
        open={ocEditorOpen}
        schemaDn={schemaDn}
        initial={ocEditing}
        onClose={() => setOcEditorOpen(false)}
        onSaved={handleSaved}
      />
      <AtEditor
        open={atEditorOpen}
        schemaDn={schemaDn}
        initial={atEditing}
        onClose={() => setAtEditorOpen(false)}
        onSaved={handleSaved}
      />
    </div>
  );
};

export default SchemaBrowser;

