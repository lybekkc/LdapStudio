import React, { useState } from "react";
import {
  Button, Select, Space, Table, Tag, Typography, Alert,
  Radio, Divider, Empty, Tooltip,
} from "antd";
import {
  ApiOutlined, DiffOutlined, DownloadOutlined, ReloadOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../store/appStore";
import * as api from "../api/commands";
import type { ConnectionProfile, SchemaInfo, SchemaDiffItem, DiffStatus } from "../types";
import type { ObjectClass, AttributeType } from "../types";
import { ConnectionForm } from "./ConnectionDialog";

const { Title, Text } = Typography;

// ─── Diff logic ───────────────────────────────────────────────────────────────

function diffObjectClasses(
  source: SchemaInfo,
  target: SchemaInfo,
  customOidPrefix: string | null,
  scope: "all" | "custom",
): SchemaDiffItem[] {
  const results: SchemaDiffItem[] = [];
  const sourceMap = new Map(source.objectClasses.map((oc) => [oc.name.toLowerCase(), oc]));
  const targetMap = new Map(target.objectClasses.map((oc) => [oc.name.toLowerCase(), oc]));

  const allNames = new Set([...sourceMap.keys(), ...targetMap.keys()]);

  for (const nameLower of allNames) {
    const src = sourceMap.get(nameLower);
    const tgt = targetMap.get(nameLower);
    const name = src?.name ?? tgt?.name ?? nameLower;

    if (scope === "custom" && customOidPrefix) {
      const oid = src?.oid ?? tgt?.oid ?? "";
      if (!oid.startsWith(customOidPrefix)) continue;
    }

    if (!src && tgt) {
      results.push({ kind: "objectClass", name, status: "added", changes: ["Present in target only"] });
    } else if (src && !tgt) {
      results.push({ kind: "objectClass", name, status: "removed", changes: ["Present in source only"] });
    } else if (src && tgt) {
      const changes = diffOcDetails(src, tgt);
      results.push({ kind: "objectClass", name, status: changes.length > 0 ? "changed" : "identical", changes });
    }
  }

  return results.sort((a, b) => statusOrder(a.status) - statusOrder(b.status) || a.name.localeCompare(b.name));
}

function diffAttributeTypes(
  source: SchemaInfo,
  target: SchemaInfo,
  customOidPrefix: string | null,
  scope: "all" | "custom",
): SchemaDiffItem[] {
  const results: SchemaDiffItem[] = [];
  const sourceMap = new Map(source.attributeTypes.map((at) => [at.name.toLowerCase(), at]));
  const targetMap = new Map(target.attributeTypes.map((at) => [at.name.toLowerCase(), at]));

  const allNames = new Set([...sourceMap.keys(), ...targetMap.keys()]);

  for (const nameLower of allNames) {
    const src = sourceMap.get(nameLower);
    const tgt = targetMap.get(nameLower);
    const name = src?.name ?? tgt?.name ?? nameLower;

    if (scope === "custom" && customOidPrefix) {
      const oid = src?.oid ?? tgt?.oid ?? "";
      if (!oid.startsWith(customOidPrefix)) continue;
    }

    if (!src && tgt) {
      results.push({ kind: "attributeType", name, status: "added", changes: ["Present in target only"] });
    } else if (src && !tgt) {
      results.push({ kind: "attributeType", name, status: "removed", changes: ["Present in source only"] });
    } else if (src && tgt) {
      const changes = diffAttrDetails(src, tgt);
      results.push({ kind: "attributeType", name, status: changes.length > 0 ? "changed" : "identical", changes });
    }
  }

  return results.sort((a, b) => statusOrder(a.status) - statusOrder(b.status) || a.name.localeCompare(b.name));
}

function diffOcDetails(a: ObjectClass, b: ObjectClass): string[] {
  const changes: string[] = [];
  if (a.kind !== b.kind) changes.push(`kind: ${a.kind} → ${b.kind}`);
  if (a.description !== b.description) changes.push(`description changed`);
  const aMust = [...a.mustAttrs].sort().join(",");
  const bMust = [...b.mustAttrs].sort().join(",");
  if (aMust !== bMust) {
    const added = b.mustAttrs.filter((m) => !a.mustAttrs.includes(m));
    const removed = a.mustAttrs.filter((m) => !b.mustAttrs.includes(m));
    if (added.length) changes.push(`MUST +[${added.join(", ")}]`);
    if (removed.length) changes.push(`MUST -[${removed.join(", ")}]`);
  }
  const aMay = [...a.mayAttrs].sort().join(",");
  const bMay = [...b.mayAttrs].sort().join(",");
  if (aMay !== bMay) {
    const added = b.mayAttrs.filter((m) => !a.mayAttrs.includes(m));
    const removed = a.mayAttrs.filter((m) => !b.mayAttrs.includes(m));
    if (added.length) changes.push(`MAY +[${added.join(", ")}]`);
    if (removed.length) changes.push(`MAY -[${removed.join(", ")}]`);
  }
  return changes;
}

function diffAttrDetails(a: AttributeType, b: AttributeType): string[] {
  const changes: string[] = [];
  if (a.syntax !== b.syntax) changes.push(`syntax: ${a.syntax ?? "—"} → ${b.syntax ?? "—"}`);
  if (a.equality !== b.equality) changes.push(`equality: ${a.equality ?? "—"} → ${b.equality ?? "—"}`);
  if (a.ordering !== b.ordering) changes.push(`ordering: ${a.ordering ?? "—"} → ${b.ordering ?? "—"}`);
  if (a.singleValue !== b.singleValue) changes.push(`singleValue: ${a.singleValue} → ${b.singleValue}`);
  if (a.usage !== b.usage) changes.push(`usage: ${a.usage} → ${b.usage}`);
  if (a.description !== b.description) changes.push(`description changed`);
  return changes;
}

function statusOrder(s: DiffStatus): number {
  return { removed: 0, added: 1, changed: 2, identical: 3 }[s];
}

// ─── Status tag ───────────────────────────────────────────────────────────────

function StatusTag({ status }: { status: DiffStatus }) {
  const cfg: Record<DiffStatus, { color: string; label: string }> = {
    added:     { color: "green",   label: "➕ Added" },
    removed:   { color: "red",     label: "➖ Removed" },
    changed:   { color: "orange",  label: "📝 Changed" },
    identical: { color: "default", label: "✅ Identical" },
  };
  const { color, label } = cfg[status];
  return <Tag color={color} style={{ fontSize: 11 }}>{label}</Tag>;
}

// ─── LDIF export ─────────────────────────────────────────────────────────────

function exportDiffAsText(items: SchemaDiffItem[], sourceProfile: string, targetProfile: string): string {
  const lines = [
    `# Schema comparison: ${sourceProfile} ↔ ${targetProfile}`,
    `# Generated: ${new Date().toISOString()}`,
    `# Items: ${items.length}`,
    "",
  ];
  for (const item of items) {
    if (item.status === "identical") continue;
    lines.push(`# [${item.status.toUpperCase()}] ${item.kind}: ${item.name}`);
    for (const c of item.changes) lines.push(`#   ${c}`);
    lines.push("");
  }
  return lines.join("\n");
}

// ─── Step types ───────────────────────────────────────────────────────────────

type Step = "connect" | "options" | "report";

// ─── Main component ──────────────────────────────────────────────────────────

const CompareSchemaView: React.FC = () => {
  const { schema, activeProfile, profiles, saveProfile } = useAppStore();

  const [step, setStep] = useState<Step>("connect");
  const [remoteProfile, setRemoteProfile] = useState<ConnectionProfile | null>(null);
  const [remoteSchema, setRemoteSchema] = useState<SchemaInfo | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [scope, setScope] = useState<"all" | "custom">("all");
  const [statusFilter, setStatusFilter] = useState<DiffStatus[]>(["added", "removed", "changed"]);
  const [kindFilter, setKindFilter] = useState<"all" | "objectClass" | "attributeType">("all");

  const customOidPrefix = activeProfile?.enterpriseBaseOid ?? null;
  const hasCustom = !!customOidPrefix;

  // ── Connect to remote ──────────────────────────────────────────────────────

  const handleConnect = async (profile: ConnectionProfile) => {
    setConnecting(true);
    setConnectError(null);
    try {
      const remote = await api.fetchRemoteSchema(profile);
      setRemoteProfile(profile);
      setRemoteSchema(remote);
      setStep("options");
    } catch (e) {
      setConnectError(String(e));
    } finally {
      setConnecting(false);
    }
  };

  const handleSelectProfile = async (profileId: string) => {
    const p = profiles.find((pr) => pr.id === profileId);
    if (p) await handleConnect(p);
  };

  // ── Diff ──────────────────────────────────────────────────────────────────

  const allDiff: SchemaDiffItem[] = React.useMemo(() => {
    if (!schema || !remoteSchema) return [];
    return [
      ...diffObjectClasses(schema, remoteSchema, customOidPrefix, scope),
      ...diffAttributeTypes(schema, remoteSchema, customOidPrefix, scope),
    ];
  }, [schema, remoteSchema, scope, customOidPrefix]);

  const visibleDiff = allDiff.filter((item) => {
    if (!statusFilter.includes(item.status)) return false;
    if (kindFilter !== "all" && item.kind !== kindFilter) return false;
    return true;
  });

  const counts = {
    added:     allDiff.filter((i) => i.status === "added").length,
    removed:   allDiff.filter((i) => i.status === "removed").length,
    changed:   allDiff.filter((i) => i.status === "changed").length,
    identical: allDiff.filter((i) => i.status === "identical").length,
  };

  // ── Table columns ─────────────────────────────────────────────────────────

  const columns = [
    {
      title: "Status",
      key: "status",
      width: 130,
      render: (_: unknown, r: SchemaDiffItem) => <StatusTag status={r.status} />,
      filters: [
        { text: "Added", value: "added" },
        { text: "Removed", value: "removed" },
        { text: "Changed", value: "changed" },
        { text: "Identical", value: "identical" },
      ],
    },
    {
      title: "Type",
      key: "kind",
      width: 120,
      render: (_: unknown, r: SchemaDiffItem) => (
        <Tag color={r.kind === "objectClass" ? "blue" : "purple"} style={{ fontSize: 11 }}>
          {r.kind === "objectClass" ? "objectClass" : "attributeType"}
        </Tag>
      ),
    },
    {
      title: "Name",
      key: "name",
      render: (_: unknown, r: SchemaDiffItem) => (
        <Text strong style={{ fontFamily: "monospace", fontSize: 12 }}>{r.name}</Text>
      ),
    },
    {
      title: "Changes",
      key: "changes",
      render: (_: unknown, r: SchemaDiffItem) => (
        <div>
          {r.changes.map((c, i) => (
            <div key={i} style={{ fontSize: 11, color: "#555" }}>{c}</div>
          ))}
        </div>
      ),
    },
  ];

  // ── Export ────────────────────────────────────────────────────────────────

  const handleExport = () => {
    const text = exportDiffAsText(
      allDiff,
      activeProfile?.name ?? "Source",
      remoteProfile?.name ?? "Target",
    );
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "schema-compare.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (!schema) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Empty description="Connect to a server first to compare schemas" />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* ── Header ── */}
      <div style={{ padding: "12px 20px", borderBottom: "1px solid #f0f0f0", background: "#fafafa", flexShrink: 0 }}>
        <Space align="center">
          <DiffOutlined style={{ fontSize: 18, color: "#1677ff" }} />
          <Title level={5} style={{ margin: 0 }}>Compare Schema</Title>
          {step !== "connect" && remoteProfile && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              <Tag color="blue">{activeProfile?.name ?? "Source"}</Tag>
              ↔
              <Tag color="purple">{remoteProfile.name}</Tag>
            </Text>
          )}
          {step === "report" && (
            <Button size="small" icon={<ReloadOutlined />} onClick={() => { setStep("connect"); setRemoteSchema(null); setRemoteProfile(null); }}>
              New comparison
            </Button>
          )}
        </Space>
      </div>

      {/* ── Step: Connect ── */}
      {step === "connect" && (
        <div style={{ flex: 1, overflow: "auto", padding: "20px" }}>
          <Alert
            type="info"
            showIcon
            message={`Source: ${activeProfile?.name ?? "Current connection"}`}
            description="Select or configure the target server to compare against."
            style={{ marginBottom: 20, maxWidth: 600 }}
          />

          {profiles.length > 0 && (
            <>
              <Title level={5} style={{ fontSize: 13 }}>Saved Profiles</Title>
              <Space wrap style={{ marginBottom: 20 }}>
                {profiles.map((p) => (
                  <Button
                    key={p.id}
                    icon={<ApiOutlined />}
                    loading={connecting}
                    onClick={() => handleSelectProfile(p.id)}
                    disabled={p.id === activeProfile?.id}
                  >
                    {p.name}
                    {p.id === activeProfile?.id && " (current)"}
                  </Button>
                ))}
              </Space>
              <Divider>or configure a new connection</Divider>
            </>
          )}

          {connectError && (
            <Alert type="error" message="Connection failed" description={connectError} showIcon closable style={{ marginBottom: 16, maxWidth: 600 }} />
          )}

          <div style={{ maxWidth: 560 }}>
            <ConnectionForm
              onSave={async (p) => { await saveProfile(p); }}
              onConnect={handleConnect}
              loading={connecting}
            />
          </div>
        </div>
      )}

      {/* ── Step: Options ── */}
      {step === "options" && (
        <div style={{ flex: 1, overflow: "auto", padding: "30px 20px" }}>
          <div style={{ maxWidth: 480 }}>
            <Title level={5} style={{ fontSize: 13, marginBottom: 16 }}>Comparison scope</Title>

            <Radio.Group
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <Radio value="all">
                <div>
                  <Text strong>All schema</Text>
                  <div><Text type="secondary" style={{ fontSize: 11 }}>Compare all objectClasses and attributeTypes</Text></div>
                </div>
              </Radio>
              <Radio value="custom" disabled={!hasCustom}>
                <div>
                  <Text strong style={{ color: hasCustom ? undefined : "#bbb" }}>Custom schema only</Text>
                  <div>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {hasCustom
                        ? `Only entries with OID prefix: ${customOidPrefix}`
                        : "No enterprise OID configured for this profile"}
                    </Text>
                  </div>
                </div>
              </Radio>
            </Radio.Group>

            <Button
              type="primary"
              icon={<DiffOutlined />}
              style={{ marginTop: 24 }}
              onClick={() => setStep("report")}
            >
              Run comparison
            </Button>
          </div>
        </div>
      )}

      {/* ── Step: Report ── */}
      {step === "report" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Filters + stats bar */}
          <div style={{ padding: "8px 16px", borderBottom: "1px solid #f0f0f0", background: "#fff", flexShrink: 0, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <Space size={4}>
              {(["added", "removed", "changed", "identical"] as DiffStatus[]).map((s) => (
                <Tag
                  key={s}
                  style={{ cursor: "pointer", opacity: statusFilter.includes(s) ? 1 : 0.4, userSelect: "none" }}
                  color={statusFilter.includes(s) ? ({ added: "green", removed: "red", changed: "orange", identical: "default" }[s]) : "default"}
                  onClick={() => setStatusFilter((prev) =>
                    prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
                  )}
                >
                  {s} ({counts[s]})
                </Tag>
              ))}
            </Space>

            <Select
              size="small"
              value={kindFilter}
              onChange={setKindFilter}
              style={{ width: 150 }}
              options={[
                { value: "all", label: "All types" },
                { value: "objectClass", label: "objectClass" },
                { value: "attributeType", label: "attributeType" },
              ]}
            />

            <div style={{ marginLeft: "auto" }}>
              <Tooltip title="Export comparison summary as text file">
                <Button size="small" icon={<DownloadOutlined />} onClick={handleExport}>
                  Export
                </Button>
              </Tooltip>
            </div>
          </div>

          {/* Table */}
          <div style={{ flex: 1, overflow: "auto" }}>
            <Table<SchemaDiffItem>
              dataSource={visibleDiff}
              columns={columns}
              rowKey={(r) => `${r.kind}-${r.name}`}
              pagination={false}
              size="small"
              locale={{ emptyText: <Empty description="No differences matching current filters" /> }}
              rowClassName={(r) => r.status === "identical" ? "diff-identical" : ""}
            />
          </div>
        </div>
      )}

    </div>
  );
};

export default CompareSchemaView;
