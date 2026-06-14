import React, { useEffect, useState } from "react";
import { Tabs, Table, Input, Tag, Spin, Empty, Descriptions, Drawer, Typography, Button, Tooltip, Switch, Modal, message } from "antd";
import { PlusOutlined, EditOutlined, ReloadOutlined, DownloadOutlined, CodeOutlined } from "@ant-design/icons";
import { save as dialogSave } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useAppStore } from "../store/appStore";
import { OcEditor, AtEditor } from "./SchemaEditor";
import type { AttributeType, ObjectClass } from "../types";

const { Search } = Input;
const { Text } = Typography;

// ─── Schema DN detection ─────────────────────────────────────────────────────

async function detectSchemaDn(): Promise<string> {
  return "cn=schema";
}

// ─── Custom OID detection ─────────────────────────────────────────────────────

/**
 * OID prefixes belonging to well-known standard / vendor LDAP schemas.
 * Anything NOT matching these is considered potentially custom/user-defined.
 */
const STANDARD_OID_PREFIXES = [
  "2.5.",               // X.500 / ITU-T core schema (cn, sn, person, etc.)
  "0.9.2342.",          // RFC 1274 / inetOrgPerson (uid, mail, dc, etc.)
  "1.3.6.1.4.1.1466.", // IETF LDAP (RFC 4519, 4523, etc.)
  "1.3.6.1.4.1.4203.", // OpenLDAP Foundation
  "1.3.6.1.4.1.18060.",// Apache Directory Server
  "1.3.6.1.4.1.42.",   // Sun / Oracle Directory Server
  "1.3.6.1.4.1.7165.", // Samba
  "1.3.6.1.4.1.11.",   // HP / Hewlett-Packard
  "1.3.6.1.4.1.15953.",// 389 DS / Red Hat DS
  "1.3.6.1.4.1.26027.",// Oracle Unified Directory
  "1.3.6.1.4.1.2554.", // OpenDJ / ForgeRock
  "1.3.6.1.1.",        // LDAP protocol extensions
  "1.2.840.",          // US national (RSA, PKCS, etc.)
  "2.16.840.",         // US ANSI (PKIX, X.509, etc.)
  "1.3.14.3.2.",       // ISO/IEC (DES, SHA, etc.)
];

function isStandardOid(oid: string): boolean {
  return STANDARD_OID_PREFIXES.some((p) => oid.startsWith(p));
}

// ─── Enterprise OID utilities ─────────────────────────────────────────────────

/**
 * Detect the IANA Private Enterprise Number arc (1.3.6.1.4.1.XXXXX)
 * from a list of custom OIDs. Returns the most-used enterprise base OID.
 */
export function detectEnterpriseBase(oids: string[]): string | null {
  const penOids = oids.filter(
    (oid) => oid.startsWith("1.3.6.1.4.1.") && !isStandardOid(oid)
  );
  if (penOids.length === 0) return null;

  const counts = new Map<string, number>();
  for (const oid of penOids) {
    const parts = oid.split(".");
    if (parts.length < 7) continue;
    const base = parts.slice(0, 7).join("."); // 1.3.6.1.4.1.XXXXX
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  let best: string | null = null;
  let max = 0;
  for (const [base, count] of counts) {
    if (count > max) { max = count; best = base; }
  }
  return best;
}

/**
 * Given a set of existing OIDs under a common base, suggest the next
 * available OID by finding the common sub-arc and incrementing the max leaf.
 */
export function suggestNextOid(enterpriseBase: string, oids: string[]): string {
  const under = oids.filter(
    (oid) => oid.startsWith(enterpriseBase + ".") && !isStandardOid(oid)
  );
  if (under.length === 0) return `${enterpriseBase}.1`;

  // Find the most common parent path (one level below enterprise base)
  const pathCounts = new Map<string, number>();
  for (const oid of under) {
    const parts = oid.split(".");
    if (parts.length < 8) continue;
    const parent = parts.slice(0, 8).join("."); // 1.3.6.1.4.1.X.Y
    pathCounts.set(parent, (pathCounts.get(parent) ?? 0) + 1);
  }

  let parentArc = enterpriseBase;
  let maxPCount = 0;
  for (const [p, c] of pathCounts) {
    if (c > maxPCount) { maxPCount = c; parentArc = p; }
  }

  // Find siblings under parentArc and get max leaf
  const siblings = under.filter((oid) => {
    const parts = oid.split(".");
    const parent = parts.slice(0, -1).join(".");
    return parent === parentArc;
  });
  const maxLeaf = siblings.reduce((m, oid) => {
    const leaf = parseInt(oid.split(".").pop() ?? "0", 10);
    return isNaN(leaf) ? m : Math.max(m, leaf);
  }, 0);

  return `${parentArc}.${maxLeaf + 1}`;
}

// ─── Custom schema LDIF export ────────────────────────────────────────────────

/**
 * Build an LDIF file that adds the given custom attributeTypes and objectClasses
 * to cn=schema via a single `changetype: modify` entry.
 *
 * AttributeTypes are exported first because objectClasses may depend on them.
 * Each definition is taken from the server's raw string (as returned in schema).
 */
function buildCustomSchemaLdif(
  schemaDn: string,
  customAts: AttributeType[],
  customOcs: ObjectClass[],
  enterpriseBase: string | null,
  serverHost: string,
): string {
  const now = new Date().toISOString();
  const lines: string[] = [
    "version: 1",
    "#",
    "# Custom schema export — LDAP Studio",
    `# Generated : ${now}`,
    `# Server    : ${serverHost}`,
    ...(enterpriseBase ? [`# PEN base  : ${enterpriseBase}`] : []),
    `# Custom ATs: ${customAts.length}`,
    `# Custom OCs: ${customOcs.length}`,
    "#",
    "# To import to another server:",
    "#   ldapmodify -H ldaps://host -D 'cn=admin,cn=config' -W -f this_file.ldif",
    "#",
    "",
  ];

  if (customAts.length === 0 && customOcs.length === 0) {
    lines.push("# No custom schema definitions found.");
    return lines.join("\n");
  }

  lines.push(`dn: ${schemaDn}`, "changetype: modify");

  // ── attributeTypes first ──────────────────────────────────────────────────
  if (customAts.length > 0) {
    lines.push("add: attributeTypes");
    for (const at of customAts) {
      const raw = at.raw?.trim() ?? `( ${at.oid} NAME '${at.name}' )`;
      lines.push(`attributeTypes: ${raw}`);
    }
    lines.push("-");
  }

  // ── objectClasses second ──────────────────────────────────────────────────
  if (customOcs.length > 0) {
    lines.push("add: objectClasses");
    for (const oc of customOcs) {
      const raw = oc.raw?.trim() ?? `( ${oc.oid} NAME '${oc.name}' STRUCTURAL )`;
      lines.push(`objectClasses: ${raw}`);
    }
    lines.push("-");
  }

  lines.push("");
  return lines.join("\n");
}

const kindColors: Record<string, string> = {
  STRUCTURAL: "blue",
  AUXILIARY: "purple",
  ABSTRACT: "default",
};

interface OcTabProps {
  filter: string;
  schemaDn: string;
  readOnly: boolean;
  customOnly: boolean;
  enterpriseBase: string | null;
  onEdit: (oc: ObjectClass) => void;
  onNew: () => void;
}

const ObjectClassesTab: React.FC<OcTabProps> = ({ filter, customOnly, enterpriseBase, readOnly, onEdit, onNew }) => {
  const schema = useAppStore((s) => s.schema);
  const [selected, setSelected] = useState<ObjectClass | null>(null);

  if (!schema) return null;

  const isCustomOid = (oid: string) =>
    enterpriseBase ? oid.startsWith(enterpriseBase + ".") || oid === enterpriseBase : !isStandardOid(oid);

  const filtered = schema.objectClasses.filter((oc) => {
    if (customOnly && !isCustomOid(oc.oid)) return false;
    return !filter ||
      oc.name.toLowerCase().includes(filter.toLowerCase()) ||
      oc.oid.includes(filter);
  });

  const columns = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      sorter: (a: ObjectClass, b: ObjectClass) => a.name.localeCompare(b.name),
      render: (name: string, record: ObjectClass) => (
        <span>
          <a onClick={() => setSelected(record)}>{name || record.oid}</a>
          {isCustomOid(record.oid) && (
            <Tag color="volcano" style={{ marginLeft: 6, fontSize: 10 }}>custom</Tag>
          )}
        </span>
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
          <Tooltip title="Edit definition">
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
            New ObjectClass
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
            Edit
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
  customOnly: boolean;
  enterpriseBase: string | null;
  onEdit: (at: AttributeType) => void;
  onNew: () => void;
}

const AttributeTypesTab: React.FC<AtTabProps> = ({ filter, customOnly, enterpriseBase, readOnly, onEdit, onNew }) => {
  const schema = useAppStore((s) => s.schema);
  const [selected, setSelected] = useState<AttributeType | null>(null);

  if (!schema) return null;

  const isCustomOid = (oid: string) =>
    enterpriseBase ? oid.startsWith(enterpriseBase + ".") || oid === enterpriseBase : !isStandardOid(oid);

  const filtered = schema.attributeTypes.filter((at) => {
    if (customOnly && !isCustomOid(at.oid)) return false;
    return !filter ||
      at.name.toLowerCase().includes(filter.toLowerCase()) ||
      at.oid.includes(filter);
  });

  const columns = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      sorter: (a: AttributeType, b: AttributeType) => a.name.localeCompare(b.name),
      render: (name: string, record: AttributeType) => (
        <span>
          <a onClick={() => setSelected(record)}>{name || record.oid}</a>
          {isCustomOid(record.oid) && (
            <Tag color="volcano" style={{ marginLeft: 6, fontSize: 10 }}>custom</Tag>
          )}
        </span>
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
          <Tooltip title="Edit definition">
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
            New AttributeType
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
            Edit
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
  const [ocEditing,    setOcEditing]    = useState<ObjectClass | null>(null);
  const [atEditorOpen, setAtEditorOpen] = useState(false);
  const [atEditing,    setAtEditing]    = useState<AttributeType | null>(null);
  const [customOnly,   setCustomOnly]   = useState(false);
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false);
  const [exportLdif,        setExportLdif]        = useState("");

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

  const handleExportCustomSchema = () => {
    if (!schema) return;
    const penBase = activeProfile?.enterpriseBaseOid?.trim() || null;
    const allOids = [
      ...schema.objectClasses.map((oc) => oc.oid),
      ...schema.attributeTypes.map((at) => at.oid),
    ];
    const detectedBase = penBase || detectEnterpriseBase(allOids.filter(o => !isStandardOid(o)));
    const isCustom = (oid: string) =>
      detectedBase ? oid.startsWith(detectedBase + ".") || oid === detectedBase : !isStandardOid(oid);

    const customAts = schema.attributeTypes.filter((at) => isCustom(at.oid));
    const customOcs = schema.objectClasses.filter((oc) => isCustom(oc.oid));
    if (customAts.length === 0 && customOcs.length === 0) {
      message.info("No custom schema definitions found to export.");
      return;
    }
    const ldif = buildCustomSchemaLdif(
      schemaDn,
      customAts,
      customOcs,
      penBase,
      activeProfile?.host ?? "unknown",
    );
    setExportLdif(ldif);
    setExportPreviewOpen(true);
  };

  const handleDownloadLdif = async () => {
    const host = activeProfile?.host?.replace(/[^a-z0-9]/gi, "_") ?? "ldap";
    const suggestedName = `custom-schema_${host}.ldif`;
    const filePath = await dialogSave({
      title: "Save custom schema LDIF",
      defaultPath: suggestedName,
      filters: [{ name: "LDIF", extensions: ["ldif", "ldf", "txt"] }],
    });
    if (!filePath) return;
    await writeTextFile(filePath, exportLdif);
    message.success("Custom schema exported successfully");
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

  const allCustomOids = [
    ...schema.objectClasses.filter((oc) => !isStandardOid(oc.oid)).map((oc) => oc.oid),
    ...schema.attributeTypes.filter((at) => !isStandardOid(at.oid)).map((at) => at.oid),
  ];

  // Prefer manually configured PEN from connection profile; fall back to auto-detection
  const enterpriseBase: string | null =
    activeProfile?.enterpriseBaseOid?.trim() || detectEnterpriseBase(allCustomOids);

  const penNumber = enterpriseBase?.split(".")[6] ?? null;
  const isManualPen = !!activeProfile?.enterpriseBaseOid?.trim();

  const isCustomOid = (oid: string) =>
    enterpriseBase ? oid.startsWith(enterpriseBase + ".") || oid === enterpriseBase : !isStandardOid(oid);

  const customOcCount = schema.objectClasses.filter((oc) => isCustomOid(oc.oid)).length;
  const customAtCount = schema.attributeTypes.filter((at) => isCustomOid(at.oid)).length;

  const tabItems = [
    {
      key: "oc",
      label: customOnly
        ? `Custom OC (${customOcCount})`
        : `Object Classes (${schema.objectClasses.length})`,
      children: (
        <ObjectClassesTab
          filter={filter}
          schemaDn={schemaDn}
          readOnly={isReadOnly}
          customOnly={customOnly}
          enterpriseBase={enterpriseBase}
          onEdit={oc => { setOcEditing(oc); setOcEditorOpen(true); }}
          onNew={() => { setOcEditing(null); setOcEditorOpen(true); }}
        />
      ),
    },
    {
      key: "at",
      label: customOnly
        ? `Custom Attributes (${customAtCount})`
        : `Attribute Types (${schema.attributeTypes.length})`,
      children: (
        <AttributeTypesTab
          filter={filter}
          schemaDn={schemaDn}
          readOnly={isReadOnly}
          customOnly={customOnly}
          enterpriseBase={enterpriseBase}
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

      {/* Enterprise OID banner */}
      {enterpriseBase && (
        <div style={{
          marginBottom: 10, padding: "6px 12px",
          background: "#fff7e6", border: "1px solid #ffd591", borderRadius: 6,
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        }}>
          <span style={{ fontSize: 12 }}>
            🏢 <strong>{isManualPen ? "Enterprise OID prefix:" : "Detected enterprise OID:"}</strong>{" "}
            <Text code style={{ fontSize: 12 }}>{enterpriseBase}</Text>
            {penNumber && (
              <span style={{ color: "#888", marginLeft: 6 }}>
                (IANA PEN: <strong>{penNumber}</strong>)
              </span>
            )}
            {!isManualPen && (
              <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                — auto-detected. Set manually in Connection Profile for better accuracy.
              </Text>
            )}
          </span>
          <span style={{ color: "#888", fontSize: 11 }}>
            Matching: OIDs starting with{" "}
            <Text code style={{ fontSize: 10 }}>{enterpriseBase}.<strong>*</strong></Text>
            {" "}— {customOcCount} custom OCs · {customAtCount} custom attrs
          </span>
          {penNumber && (
            <a
              href={`https://www.iana.org/assignments/enterprise-numbers/enterprise-numbers`}
              target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, marginLeft: "auto" }}
            >
              Verify in IANA registry ↗
            </a>
          )}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Search
          placeholder="Filter by name or OID…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          allowClear
          style={{ maxWidth: 380 }}
        />
        <Tooltip title={`Show custom/non-standard definitions only (${customOcCount} OC, ${customAtCount} attrs)`}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, whiteSpace: "nowrap" }}>
            <Switch size="small" checked={customOnly} onChange={setCustomOnly} />
            <span style={{ color: customOnly ? "#d4380d" : "#888" }}>
              Custom only
            </span>
          </span>
        </Tooltip>
        <div style={{ flex: 1 }} />
        <Text type="secondary" style={{ fontSize: 11 }}>Schema DN:</Text>
        <Input
          size="small"
          value={schemaDn}
          onChange={e => setSchemaDn(e.target.value)}
          style={{ width: 200, fontFamily: "monospace", fontSize: 11 }}
        />
        <Tooltip title="Reload schema">
          <Button size="small" icon={<ReloadOutlined />} onClick={reloadSchema} loading={schemaLoading}>
            Reload
          </Button>
        </Tooltip>
        <Tooltip title={`Export custom schema to LDIF (${customOcCount} OC, ${customAtCount} attrs)`}>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={handleExportCustomSchema}
            disabled={customOcCount === 0 && customAtCount === 0}
          >
            Export custom schema
          </Button>
        </Tooltip>
      </div>
      <Tabs items={tabItems} style={{ flex: 1 }} />

      {/* Editors */}
      <OcEditor
        open={ocEditorOpen}
        schemaDn={schemaDn}
        initial={ocEditing}
        enterpriseBase={enterpriseBase}
        onClose={() => setOcEditorOpen(false)}
        onSaved={handleSaved}
      />
      <AtEditor
        open={atEditorOpen}
        schemaDn={schemaDn}
        initial={atEditing}
        enterpriseBase={enterpriseBase}
        onClose={() => setAtEditorOpen(false)}
        onSaved={handleSaved}
      />

      {/* ── Custom schema export preview ──────────────────────────────────── */}
      <Modal
        open={exportPreviewOpen}
        title={<span><CodeOutlined style={{ marginRight: 8 }} />Custom schema — LDIF export</span>}
        width={720}
        onCancel={() => setExportPreviewOpen(false)}
        footer={
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              Import on target server:{" "}
              <Typography.Text code style={{ fontSize: 11 }}>
                ldapmodify -H ldaps://host -D 'cn=admin,cn=config' -W -f schema.ldif
              </Typography.Text>
            </Typography.Text>
            <div style={{ display: "flex", gap: 8 }}>
              <Button onClick={() => setExportPreviewOpen(false)}>Close</Button>
              <Button
                icon={<DownloadOutlined />}
                onClick={async () => {
                  await navigator.clipboard.writeText(exportLdif);
                  message.success("Copied to clipboard");
                }}
              >
                Copy to clipboard
              </Button>
              <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownloadLdif}>
                Save as .ldif
              </Button>
            </div>
          </div>
        }
      >
        <Input.TextArea
          value={exportLdif}
          readOnly
          rows={22}
          style={{ fontFamily: "monospace", fontSize: 11 }}
        />
      </Modal>
    </div>
  );
};

export default SchemaBrowser;



