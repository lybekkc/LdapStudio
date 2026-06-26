import React, { useState } from "react";
import {
  Button, Select, Space, Table, Tag, Typography, Alert,
  Radio, Divider, Empty, Tooltip, Modal,
} from "antd";
import {
  ApiOutlined, DiffOutlined, DownloadOutlined, ReloadOutlined,
  ArrowRightOutlined, ArrowLeftOutlined, WarningOutlined,
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
  sourceName: string,
  targetName: string,
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

    const sourceRaw = src?.raw ?? null;
    const targetRaw = tgt?.raw ?? null;

    if (!src && tgt) {
      results.push({ kind: "objectClass", name, status: "added", changes: [`Only in ${targetName}`], sourceRaw, targetRaw });
    } else if (src && !tgt) {
      results.push({ kind: "objectClass", name, status: "removed", changes: [`Only in ${sourceName}`], sourceRaw, targetRaw });
    } else if (src && tgt) {
      const changes = diffOcDetails(src, tgt, sourceName, targetName);
      results.push({ kind: "objectClass", name, status: changes.length > 0 ? "changed" : "identical", changes, sourceRaw, targetRaw });
    }
  }

  return results.sort((a, b) => statusOrder(a.status) - statusOrder(b.status) || a.name.localeCompare(b.name));
}

function diffAttributeTypes(
  source: SchemaInfo,
  target: SchemaInfo,
  customOidPrefix: string | null,
  scope: "all" | "custom",
  sourceName: string,
  targetName: string,
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

    const sourceRaw = src?.raw ?? null;
    const targetRaw = tgt?.raw ?? null;

    if (!src && tgt) {
      results.push({ kind: "attributeType", name, status: "added", changes: [`Only in ${targetName}`], sourceRaw, targetRaw });
    } else if (src && !tgt) {
      results.push({ kind: "attributeType", name, status: "removed", changes: [`Only in ${sourceName}`], sourceRaw, targetRaw });
    } else if (src && tgt) {
      const changes = diffAttrDetails(src, tgt, sourceName, targetName);
      results.push({ kind: "attributeType", name, status: changes.length > 0 ? "changed" : "identical", changes, sourceRaw, targetRaw });
    }
  }

  return results.sort((a, b) => statusOrder(a.status) - statusOrder(b.status) || a.name.localeCompare(b.name));
}

function diffOcDetails(a: ObjectClass, b: ObjectClass, sourceName: string, targetName: string): string[] {
  const changes: string[] = [];
  if (a.kind !== b.kind) changes.push(`kind: ${sourceName}=${a.kind} → ${targetName}=${b.kind}`);
  if (a.description !== b.description) changes.push(`description changed`);

  // Detect MUST↔MAY moves explicitly
  const mustToMay = a.mustAttrs.filter((m) => !b.mustAttrs.includes(m) && b.mayAttrs.includes(m));
  const mayToMust = a.mayAttrs.filter((m) => !b.mayAttrs.includes(m) && b.mustAttrs.includes(m));
  for (const attr of mustToMay) changes.push(`${attr}: MUST in ${sourceName} → MAY in ${targetName}`);
  for (const attr of mayToMust) changes.push(`${attr}: MAY in ${sourceName} → MUST in ${targetName}`);

  // Pure additions/removals from MUST (not moves)
  const mustAdded   = b.mustAttrs.filter((m) => !a.mustAttrs.includes(m) && !mayToMust.includes(m));
  const mustRemoved = a.mustAttrs.filter((m) => !b.mustAttrs.includes(m) && !mustToMay.includes(m));
  if (mustAdded.length)   changes.push(`MUST added in ${targetName}: [${mustAdded.join(", ")}]`);
  if (mustRemoved.length) changes.push(`MUST removed in ${targetName}: [${mustRemoved.join(", ")}]`);

  // Pure additions/removals from MAY (not moves)
  const mayAdded   = b.mayAttrs.filter((m) => !a.mayAttrs.includes(m) && !mustToMay.includes(m));
  const mayRemoved = a.mayAttrs.filter((m) => !b.mayAttrs.includes(m) && !mayToMust.includes(m));
  if (mayAdded.length)   changes.push(`MAY added in ${targetName}: [${mayAdded.join(", ")}]`);
  if (mayRemoved.length) changes.push(`MAY removed in ${targetName}: [${mayRemoved.join(", ")}]`);

  return changes;
}

function diffAttrDetails(a: AttributeType, b: AttributeType, sourceName: string, targetName: string): string[] {
  const changes: string[] = [];
  if (a.syntax !== b.syntax)         changes.push(`syntax: ${sourceName}=${a.syntax ?? "—"} → ${targetName}=${b.syntax ?? "—"}`);
  if (a.equality !== b.equality)     changes.push(`equality: ${sourceName}=${a.equality ?? "—"} → ${targetName}=${b.equality ?? "—"}`);
  if (a.ordering !== b.ordering)     changes.push(`ordering: ${sourceName}=${a.ordering ?? "—"} → ${targetName}=${b.ordering ?? "—"}`);
  if (a.singleValue !== b.singleValue) changes.push(`singleValue: ${sourceName}=${a.singleValue} → ${targetName}=${b.singleValue}`);
  if (a.usage !== b.usage)           changes.push(`usage: ${sourceName}=${a.usage} → ${targetName}=${b.usage}`);
  if (a.description !== b.description) changes.push(`description changed`);
  return changes;
}

function statusOrder(s: DiffStatus): number {
  return { removed: 0, added: 1, changed: 2, identical: 3 }[s];
}

// ─── Status tag ───────────────────────────────────────────────────────────────

function StatusTag({ status, sourceName, targetName }: { status: DiffStatus; sourceName: string; targetName: string }) {
  const cfg: Record<DiffStatus, { color: string; label: string }> = {
    added:     { color: "green",   label: `Only in ${targetName}` },
    removed:   { color: "red",     label: `Only in ${sourceName}` },
    changed:   { color: "orange",  label: "Different" },
    identical: { color: "default", label: "Identical" },
  };
  const { color, label } = cfg[status];
  return <Tag color={color} style={{ fontSize: 11 }}>{label}</Tag>;
}

function rowBg(status: DiffStatus): string {
  return { added: "#f6ffed", removed: "#fff1f0", changed: "#fffbe6", identical: "#fff" }[status];
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

// ─── Apply helpers ────────────────────────────────────────────────────────────

/** Compute old_raw / new_raw for a diff item depending on apply direction. */
function getApplyParams(item: SchemaDiffItem, direction: "toTarget" | "toSource") {
  const attrName = item.kind === "objectClass" ? "objectClasses" : "attributeTypes";
  let oldRaw = "";
  let newRaw = "";
  if (direction === "toTarget") {
    // Make target look like source
    oldRaw = item.targetRaw ?? "";
    newRaw = item.sourceRaw ?? "";
  } else {
    // Make source look like target
    oldRaw = item.sourceRaw ?? "";
    newRaw = item.targetRaw ?? "";
  }
  return { attrName, oldRaw, newRaw };
}

// ─── Main component ──────────────────────────────────────────────────────────

const CompareSchemaView: React.FC = () => {
  const { schema, activeProfile, profiles, saveProfile, modifySchemaEntry, addModLog } = useAppStore();

  const [step, setStep] = useState<Step>("connect");
  const [remoteProfile, setRemoteProfile] = useState<ConnectionProfile | null>(null);
  const [remoteSchema, setRemoteSchema] = useState<SchemaInfo | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [scope, setScope] = useState<"all" | "custom">("all");
  const [statusFilter, setStatusFilter] = useState<DiffStatus[]>(["added", "removed", "changed"]);
  const [kindFilter, setKindFilter] = useState<"all" | "objectClass" | "attributeType">("all");

  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{ ok: number; fail: number; direction: string } | null>(null);

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

  // ── Apply changes ─────────────────────────────────────────────────────────

  const handleApply = (direction: "toTarget" | "toSource") => {
    const items = allDiff.filter((i) => selectedKeys.includes(`${i.kind}-${i.name}`) && i.status !== "identical");
    if (items.length === 0) return;

    const targetServer = direction === "toTarget" ? targetName : sourceName;
    const isTargetReadOnly = direction === "toTarget"
      ? (remoteProfile?.readOnly ?? false)
      : (activeProfile?.readOnly ?? false);

    Modal.confirm({
      title: `Apply ${items.length} change${items.length > 1 ? "s" : ""} to ${targetServer}`,
      icon: isTargetReadOnly ? <WarningOutlined style={{ color: "#ff4d4f" }} /> : undefined,
      content: (
        <div>
          {isTargetReadOnly && (
            <Alert
              type="error"
              showIcon
              message={`${targetServer} is marked read-only`}
              description="This profile has write operations disabled. Applying changes may fail or be blocked."
              style={{ marginBottom: 12 }}
            />
          )}
          {direction === "toTarget" && (
            <Alert
              type="warning"
              showIcon
              message="Cannot be undone"
              description={`Changes applied to ${targetName} are not tracked in the undo history. Make sure you have a backup.`}
              style={{ marginBottom: 12 }}
            />
          )}
          {direction === "toSource" && (
            <Alert
              type="info"
              showIcon
              message="Supports undo"
              description={`Changes to ${sourceName} will be added to the undo history and can be reverted.`}
              style={{ marginBottom: 12 }}
            />
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>The following will be applied to <strong>{targetServer}</strong>:</Text>
          <div style={{ maxHeight: 200, overflow: "auto", marginTop: 8 }}>
            {items.map((i) => (
              <div key={`${i.kind}-${i.name}`} style={{ fontSize: 12, fontFamily: "monospace", padding: "2px 0" }}>
                <Tag color={i.status === "added" ? "green" : i.status === "removed" ? "red" : "orange"} style={{ fontSize: 10 }}>
                  {i.status}
                </Tag>
                {i.kind === "objectClass" ? "OC" : "AT"}: {i.name}
              </div>
            ))}
          </div>
        </div>
      ),
      okText: isTargetReadOnly ? "Apply anyway" : "Apply",
      okType: isTargetReadOnly ? "danger" : "primary",
      cancelText: "Cancel",
      width: 520,
      onOk: async () => {
        setApplying(true);
        let ok = 0; let fail = 0;
        for (const item of items) {
          const { attrName, oldRaw, newRaw } = getApplyParams(item, direction);
          const opLabel = !oldRaw ? "Created" : !newRaw ? "Deleted" : "Modified";
          const typeLabel = item.kind === "objectClass" ? "ObjectClass" : "AttributeType";
          const description = `${opLabel} ${typeLabel}: ${item.name} (via Compare)`;
          const schemaDn = direction === "toTarget" ? (remoteSchema?.schemaDn ?? "") : (schema?.schemaDn ?? "");
          const logOp = !oldRaw ? "add" : !newRaw ? "delete" : "modify";
          try {
            if (direction === "toTarget" && remoteProfile && remoteSchema) {
              await api.applySchemaChangeRemote(remoteProfile, remoteSchema.schemaDn, attrName, oldRaw, newRaw);
            } else if (direction === "toSource" && schema) {
              await modifySchemaEntry(schema.schemaDn, attrName, oldRaw, newRaw, description);
            }
            addModLog({
              id: crypto.randomUUID(),
              timestamp: new Date().toISOString(),
              operation: "schema",
              dn: schemaDn,
              details: `changetype: ${logOp}\nattribute: ${attrName}\nname: ${item.name}`,
              success: true,
              server: direction === "toTarget" ? targetName : undefined,
            });
            ok++;
          } catch (e) {
            console.error("Apply schema change failed:", e);
            addModLog({
              id: crypto.randomUUID(),
              timestamp: new Date().toISOString(),
              operation: "schema",
              dn: schemaDn,
              details: `changetype: ${logOp}\nattribute: ${attrName}\nname: ${item.name}`,
              success: false,
              error: String(e),
              server: direction === "toTarget" ? targetName : undefined,
            });
            fail++;
          }
        }

        // Reload schemas so diff reflects the changes
        try {
          if (direction === "toSource") {
            const updated = await api.getSchema();
            useAppStore.setState({ schema: updated });
          } else if (direction === "toTarget" && remoteProfile) {
            const updated = await api.fetchRemoteSchema(remoteProfile);
            setRemoteSchema(updated);
          }
        } catch (e) {
          console.error("Schema reload after apply failed:", e);
        }

        setApplying(false);
        setSelectedKeys([]);
        setApplyResult({ ok, fail, direction: targetServer });
      },
    });
  };

  // ── Diff ──────────────────────────────────────────────────────────────────

  const sourceName = activeProfile?.name ?? "Source";
  const targetName = remoteProfile?.name ?? "Target";

  const allDiff: SchemaDiffItem[] = React.useMemo(() => {
    if (!schema || !remoteSchema) return [];
    return [
      ...diffObjectClasses(schema, remoteSchema, customOidPrefix, scope, sourceName, targetName),
      ...diffAttributeTypes(schema, remoteSchema, customOidPrefix, scope, sourceName, targetName),
    ];
  }, [schema, remoteSchema, scope, customOidPrefix, sourceName, targetName]);

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
      width: 160,
      render: (_: unknown, r: SchemaDiffItem) => <StatusTag status={r.status} sourceName={sourceName} targetName={targetName} />,
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
      title: "Details",
      key: "changes",
      render: (_: unknown, r: SchemaDiffItem) => (
        <div>
          {r.changes.map((c, i) => (
            <div key={i} style={{ fontSize: 11, color: "#555", fontFamily: "monospace" }}>{c}</div>
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

          {/* Apply result banner */}
          {applyResult && (
            <Alert
              type={applyResult.fail === 0 ? "success" : "warning"}
              showIcon
              closable
              onClose={() => setApplyResult(null)}
              message={
                applyResult.fail === 0
                  ? `✓ Applied ${applyResult.ok} change${applyResult.ok > 1 ? "s" : ""} to ${applyResult.direction} — schema reloaded`
                  : `${applyResult.ok} succeeded, ${applyResult.fail} failed applying to ${applyResult.direction}`
              }
              style={{ flexShrink: 0 }}
            />
          )}

          {/* Summary cards */}
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f0f0", background: "#fafafa", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              {[
                { status: "removed" as DiffStatus, label: `Only in ${sourceName}`, color: "#ff4d4f", bg: "#fff1f0", count: counts.removed },
                { status: "added"   as DiffStatus, label: `Only in ${targetName}`, color: "#52c41a", bg: "#f6ffed", count: counts.added },
                { status: "changed" as DiffStatus, label: "Different",             color: "#fa8c16", bg: "#fffbe6", count: counts.changed },
                { status: "identical" as DiffStatus, label: "Identical",           color: "#8c8c8c", bg: "#f5f5f5", count: counts.identical },
              ].map(({ status, label, color, bg, count }) => (
                <div
                  key={status}
                  onClick={() => setStatusFilter((prev) =>
                    prev.includes(status) ? prev.filter((x) => x !== status) : [...prev, status]
                  )}
                  style={{
                    cursor: "pointer", border: `1px solid ${color}33`,
                    borderRadius: 8, padding: "6px 14px", background: statusFilter.includes(status) ? bg : "#f9f9f9",
                    opacity: statusFilter.includes(status) ? 1 : 0.5, userSelect: "none",
                    display: "flex", flexDirection: "column", alignItems: "center", minWidth: 110,
                  }}
                >
                  <span style={{ fontSize: 20, fontWeight: 700, color, lineHeight: 1.2 }}>{count}</span>
                  <span style={{ fontSize: 11, color: "#555", textAlign: "center" }}>{label}</span>
                </div>
              ))}

              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
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
                <Tooltip title="Export comparison summary as text file">
                  <Button size="small" icon={<DownloadOutlined />} onClick={handleExport}>Export</Button>
                </Tooltip>
              </div>
            </div>

            <Text type="secondary" style={{ fontSize: 11 }}>
              Showing {visibleDiff.length} of {allDiff.filter(i => i.status !== "identical").length} differences
              {counts.identical > 0 && ` (${counts.identical} identical hidden by default)`}
              {" — click cards above to toggle"}
            </Text>
          </div>

          {/* Table with row selection */}
          <div style={{ flex: 1, overflow: "auto" }}>
            <Table<SchemaDiffItem>
              dataSource={visibleDiff}
              columns={columns}
              rowKey={(r) => `${r.kind}-${r.name}`}
              pagination={false}
              size="small"
              onRow={(r) => ({ style: { background: rowBg(r.status) } })}
              locale={{ emptyText: <Empty description="No differences matching current filters" /> }}
              rowSelection={{
                selectedRowKeys: selectedKeys,
                onChange: (keys) => setSelectedKeys(keys as string[]),
                getCheckboxProps: (r) => ({ disabled: r.status === "identical" }),
              }}
            />
          </div>

          {/* Apply toolbar — appears when rows are selected */}
          {selectedKeys.length > 0 && (
            <div style={{
              padding: "10px 16px", borderTop: "1px solid #f0f0f0", background: "#fff",
              flexShrink: 0, display: "flex", alignItems: "center", gap: 12,
            }}>
              <Text style={{ fontSize: 12 }}>
                <strong>{selectedKeys.length}</strong> selected
              </Text>
              <Button
                size="small"
                icon={<ArrowRightOutlined />}
                loading={applying}
                onClick={() => handleApply("toTarget")}
                danger={remoteProfile?.readOnly}
              >
                Apply to {targetName}{remoteProfile?.readOnly ? " ⚠ read-only" : ""}
              </Button>
              <Button
                size="small"
                icon={<ArrowLeftOutlined />}
                loading={applying}
                onClick={() => handleApply("toSource")}
                danger={activeProfile?.readOnly}
              >
                Apply to {sourceName}{activeProfile?.readOnly ? " ⚠ read-only" : ""}
              </Button>
              <Button size="small" onClick={() => setSelectedKeys([])}>Clear selection</Button>
            </div>
          )}
        </div>
      )}

    </div>
  );
};

export default CompareSchemaView;
