import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  Table, Tag, Typography, Spin, Empty, Switch, Tooltip, Space,
  Button, Input, AutoComplete, Modal, message, Select,
} from "antd";
import {
  CopyOutlined, CaretDownOutlined, CaretRightOutlined,
  EditOutlined, SaveOutlined, CloseOutlined, DeleteOutlined,
  PlusOutlined, BulbOutlined, BookOutlined, LockOutlined, SwapOutlined,
  ScissorOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../store/appStore";
import * as api from "../api/commands";
import { collectOcAttrs } from "../utils/schema";
import {
  isPasswordAttr, isAlreadyHashed, extractScheme,
  processPasswordMods,
  HASH_SCHEME_OPTIONS, type HashScheme,
} from "../utils/ldapPassword";
import RenameEntryModal from "./RenameEntryModal";
import type { LdapAttribute, LdapMod, SiblingAnalysis } from "../types";

const { Text, Paragraph } = Typography;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isDistinguishedName(value: string): boolean {
  return value.includes(",") && (value.includes("=") || value.startsWith("dc="));
}

function renderValue(value: string): React.ReactNode {
  if (isDistinguishedName(value)) {
    return <Text code style={{ fontSize: 12 }}>{value}</Text>;
  }
  return <span style={{ wordBreak: "break-all" }}>{value}</span>;
}

const OC_COLORS: Record<string, string> = {
  top: "default", person: "blue", inetorgperson: "blue",
  organizationalperson: "blue", organizationalunit: "cyan",
  organization: "cyan", groupofnames: "purple", groupofuniquenames: "purple",
  domain: "geekblue", country: "green",
};
function ocColor(oc: string) {
  return OC_COLORS[oc.toLowerCase()] ?? "blue";
}

// ─── Edit state helpers ───────────────────────────────────────────────────────

type EditMap = Map<string, string[]>; // attrName → current values

function buildEditMap(attrs: LdapAttribute[]): EditMap {
  const m = new Map<string, string[]>();
  for (const a of attrs) {
    if (a.name !== "objectClass") m.set(a.name, [...a.values]);
  }
  return m;
}

function computeMods(original: LdapAttribute[], editMap: EditMap): LdapMod[] {
  const mods: LdapMod[] = [];
  const origMap = new Map(
    original.filter(a => a.name !== "objectClass").map(a => [a.name, a.values])
  );

  // Modified or deleted attributes
  for (const [name, origVals] of origMap) {
    if (!editMap.has(name)) {
      mods.push({ op: "DELETE", attr: name, values: [] });
    } else {
      const newVals = editMap.get(name)!.filter(v => v.trim() !== "");
      const same = [...origVals].sort().join("\0") === [...newVals].sort().join("\0");
      if (!same) mods.push({ op: "REPLACE", attr: name, values: newVals });
    }
  }

  // New attributes
  for (const [name, vals] of editMap) {
    if (!origMap.has(name)) {
      const clean = vals.filter(v => v.trim() !== "");
      if (clean.length > 0) mods.push({ op: "ADD", attr: name, values: clean });
    }
  }
  return mods;
}

/** Diff original objectClasses vs edited list → ADD / DELETE mods for objectClass */
function computeOcMods(original: string[], edited: string[]): LdapMod[] {
  const mods: LdapMod[] = [];
  const origLower = new Set(original.map(s => s.toLowerCase()));
  const editLower = new Set(edited.map(s => s.toLowerCase()));

  // Added
  for (const oc of edited) {
    if (!origLower.has(oc.toLowerCase()))
      mods.push({ op: "ADD", attr: "objectClass", values: [oc] });
  }
  // Removed
  for (const oc of original) {
    if (!editLower.has(oc.toLowerCase()))
      mods.push({ op: "DELETE", attr: "objectClass", values: [oc] });
  }
  return mods;
}

// ─── Component ───────────────────────────────────────────────────────────────

const EntryDetails: React.FC = () => {
  const { selectedDn, selectedEntry, entryLoading, schema,
          modifyEntry, deleteEntry, activeProfile, writeUnlocked,
          copyEntryToClipboard, clipboardEntry } = useAppStore();
  const isReadOnly = (activeProfile?.readOnly === true) && !writeUnlocked;
  const [showOperational, setShowOperational] = useState(false);
  const [ocExpanded, setOcExpanded]           = useState(true);
  const [editMap, setEditMap]                 = useState<EditMap | null>(null);
  const [saving, setSaving]                   = useState(false);
  const [newAttrName, setNewAttrName]         = useState("");
  const [showNewAttr, setShowNewAttr]         = useState(false);
  const [renameOpen, setRenameOpen]           = useState(false);

  // Sibling analysis for edit-mode hints
  const [siblingAnalysis, setSiblingAnalysis] = useState<SiblingAnalysis | null>(null);
  const [siblingLoading,  setSiblingLoading]  = useState(false);
  const [hintsExpanded,       setHintsExpanded]       = useState(true);
  const [schemaHintsExpanded, setSchemaHintsExpanded] = useState(true);

  // Password hashing
  const [hashScheme, setHashScheme] = useState<HashScheme>("SSHA512");

  // ObjectClass editing
  const [ocEditList, setOcEditList] = useState<string[] | null>(null);
  const [ocAddInput, setOcAddInput] = useState("");

  // Ref so keyboard shortcut handler can call saveEdits after it's defined
  const saveEditsRef = useRef<(() => void) | null>(null);

  const isEditing = editMap !== null;

  // Derive objectClasses here (before early returns) so useMemo below is unconditional
  // When editing, use the live ocEditList so schema hints update in real-time
  const objectClasses = selectedEntry?.attributes.find(a => a.name === "objectClass")?.values ?? [];
  const currentOcs = (isEditing && ocEditList !== null) ? ocEditList : objectClasses;

  // ── Schema completeness (edit mode) — must be before early returns (hooks rules) ──
  const { schemaMustMissing, schemaMayMissing } = useMemo(() => {
    if (!schema || !editMap) return { schemaMustMissing: [], schemaMayMissing: [] };
    const { must, may } = collectOcAttrs(currentOcs, schema);
    const schemaMustMissing = Array.from(must).filter(a => !editMap.has(a)).sort();
    const schemaMayMissing  = Array.from(may)
      .filter(a => !editMap.has(a) && !must.has(a))
      .sort();
    return { schemaMustMissing, schemaMayMissing };
  }, [schema, editMap, currentOcs]);

  // ── Keyboard shortcuts — must be before early returns (hooks rules) ─────────
  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const isMod = useCallback((e: KeyboardEvent) => isMac ? e.metaKey : e.ctrlKey, [isMac]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!selectedEntry) return;
      const tag = (e.target as HTMLElement)?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;

      if (isMod(e) && e.key === "e" && !isEditing && !isReadOnly && !inInput) {
        e.preventDefault();
        setEditMap(buildEditMap(selectedEntry.attributes));
        setOcEditList([...selectedEntry.attributes.find(a => a.name === "objectClass")?.values ?? []]);
        setOcAddInput("");
        setShowNewAttr(false);
        setNewAttrName("");
        setSiblingAnalysis(null);
        setHintsExpanded(true);
        return;
      }
      if (isMod(e) && e.key === "s" && isEditing) {
        e.preventDefault();
        // Trigger save via a custom event so saveEdits (defined below) can handle it
        window.dispatchEvent(new CustomEvent("entry-save-requested"));
        return;
      }
      if (e.key === "Escape" && isEditing && !inInput) {
        e.preventDefault();
        setEditMap(null);
        setOcEditList(null);
        setOcAddInput("");
        setShowNewAttr(false);
        setSiblingAnalysis(null);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedEntry, isEditing, isReadOnly, isMod]);

  // Listen for save trigger from keyboard shortcut
  useEffect(() => {
    const handler = () => { saveEditsRef.current?.(); };
    window.addEventListener("entry-save-requested", handler);
    return () => window.removeEventListener("entry-save-requested", handler);
  }, []);

  if (!selectedDn && !entryLoading) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Select an entry in the tree" style={{ marginTop: 80 }} />;
  }
  if (entryLoading) {
    return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}><Spin size="large" /></div>;
  }
  if (!selectedEntry) return null;

  const visibleAttrs  = selectedEntry.attributes.filter(
    a => (showOperational || !a.isOperational) && a.name !== "objectClass"
  );

  // ── Edit helpers ────────────────────────────────────────────────────────────

  const startEdit = () => {
    setEditMap(buildEditMap(selectedEntry.attributes));
    setOcEditList([...objectClasses]);
    setOcAddInput("");
    setShowNewAttr(false);
    setNewAttrName("");
    setSiblingAnalysis(null);
    setHintsExpanded(true);

    // Fetch sibling analysis for attribute hints
    const parts = selectedEntry.dn.split(",");
    if (parts.length > 1) {
      const parentDn = parts.slice(1).join(",");
      setSiblingLoading(true);
      api.analyzeSiblings(parentDn, 25)
        .then(r => setSiblingAnalysis(r))
        .catch(() => {/* ignore */})
        .finally(() => setSiblingLoading(false));
    }
  };

  const cancelEdit = () => {
    setEditMap(null);
    setOcEditList(null);
    setOcAddInput("");
    setShowNewAttr(false);
    setSiblingAnalysis(null);
  };


  const updateValue = (attr: string, idx: number, val: string) =>
    setEditMap(prev => {
      const m = new Map(prev!);
      const vals = [...m.get(attr)!]; vals[idx] = val; m.set(attr, vals); return m;
    });

  const removeValue = (attr: string, idx: number) =>
    setEditMap(prev => {
      const m = new Map(prev!);
      const vals = m.get(attr)!.filter((_, i) => i !== idx);
      if (vals.length === 0) m.delete(attr); else m.set(attr, vals);
      return m;
    });

  const addValue = (attr: string) =>
    setEditMap(prev => {
      const m = new Map(prev!);
      m.set(attr, [...(m.get(attr) ?? []), ""]);
      return m;
    });

  const removeAttr = (attr: string) =>
    setEditMap(prev => { const m = new Map(prev!); m.delete(attr); return m; });

  const confirmAddAttr = () => {
    const name = newAttrName.trim();
    if (!name) return;
    setEditMap(prev => {
      const m = new Map(prev!);
      if (!m.has(name)) m.set(name, [""]);
      return m;
    });
    setNewAttrName(""); setShowNewAttr(false);
  };

  /** Add a suggested attribute from the sibling hints panel */
  const addSuggestedAttr = (name: string) => {
    setEditMap(prev => {
      const m = new Map(prev!);
      if (!m.has(name)) m.set(name, [""]);
      return m;
    });
  };

  const saveEdits = async () => {
    if (!editMap) return;
    const attrMods  = computeMods(selectedEntry.attributes, editMap);
    const ocMods    = computeOcMods(objectClasses, ocEditList ?? objectClasses);
    const allMods   = [...ocMods, ...attrMods];
    if (allMods.length === 0) { message.info("Ingen endringer å lagre"); cancelEdit(); return; }
    setSaving(true);
    try {
      // Hash any plain-text password values before sending
      const processedMods = await processPasswordMods(allMods, hashScheme);
      await modifyEntry(selectedEntry.dn, processedMods);
      message.success(`${allMods.length} endring(er) lagret`);
      setEditMap(null);
      setOcEditList(null);
      setOcAddInput("");
      setSiblingAnalysis(null);
    } catch (e) {
      message.error(`Feil: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  // Keep ref in sync so keyboard shortcut useEffect (above early returns) can call saveEdits
  saveEditsRef.current = saveEdits;

  const confirmDelete = () => {
    Modal.confirm({
      title: "Slett entry?",
      content: <Text code style={{ fontSize: 12 }}>{selectedEntry.dn}</Text>,
      okText: "Slett",
      okType: "danger",
      cancelText: "Avbryt",
      onOk: async () => {
        try {
          await deleteEntry(selectedEntry.dn);
          message.success("Entry slettet");
        } catch (e) {
          message.error(`Feil: ${e}`);
        }
      },
    });
  };

  // Schema attr suggestions for autocomplete
  const attrOptions = (schema?.attributeTypes ?? [])
    .map(a => ({ value: a.name }))
    .filter(o => !editMap?.has(o.value));

  // OC autocomplete options (exclude already-selected ones)
  const ocOptions = (schema?.objectClasses ?? [])
    .filter(o => !currentOcs.some(c => c.toLowerCase() === o.name.toLowerCase()))
    .map(o => ({
      value: o.name,
      label: (
        <span>
          {o.name}
          <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.6 }}>
            {o.kind === "STRUCTURAL" ? "structural" : o.kind === "AUXILIARY" ? "auxiliary" : "abstract"}
          </span>
        </span>
      ),
    }));


  // ── View mode columns ────────────────────────────────────────────────────────

  const viewColumns = [
    {
      title: "Attribute",
      dataIndex: "name",
      key: "name",
      width: 200,
      sorter: (a: LdapAttribute, b: LdapAttribute) => a.name.localeCompare(b.name),
      render: (name: string, record: LdapAttribute) => (
        <Space>
          <Text strong style={{ fontFamily: "monospace", fontSize: 12 }}>{name}</Text>
          {record.isOperational && <Tag color="orange" style={{ fontSize: 10 }}>op</Tag>}
        </Space>
      ),
    },
    {
      title: "Value(s)",
      key: "values",
      render: (_: unknown, record: LdapAttribute) => (
        <div>
          {record.values.map((v, i) => (
            <Paragraph key={i} style={{ margin: "2px 0", fontSize: 12 }} copyable={{ text: v }}>
              {renderValue(v)}
            </Paragraph>
          ))}
        </div>
      ),
    },
  ];

  return (
    <>
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>

      {/* ── DN header ──────────────────────────────────────────────────────── */}
      <div style={{ padding: "8px 16px", borderBottom: "1px solid #f0f0f0", background: "#fafafa", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
          <Tooltip title="Copy DN">
            <Button type="text" icon={<CopyOutlined />} size="small"
              onClick={() => navigator.clipboard.writeText(selectedEntry.dn)}
              style={{ padding: 0, flexShrink: 0, marginTop: 1 }} />
          </Tooltip>
          <Text code style={{ fontSize: 12, wordBreak: "break-all", flex: 1 }}>{selectedEntry.dn}</Text>
          <Space size={4} style={{ flexShrink: 0 }}>
            {!isEditing ? (
              <>
                <Tooltip title={isReadOnly ? "Read-only — lås opp i verktøylinjen for å redigere" : "Rediger entry"}>
                  <Button size="small" icon={<EditOutlined />} onClick={startEdit} disabled={isReadOnly}>Rediger</Button>
                </Tooltip>
                <Tooltip title={isReadOnly ? "Read-only" : "Rename / Move entry"}>
                  <Button size="small" icon={<SwapOutlined />} onClick={() => setRenameOpen(true)} disabled={isReadOnly} />
                </Tooltip>
                <Tooltip title={clipboardEntry?.sourceDn === selectedEntry.dn ? "Copied! (⌘V to paste)" : "Copy entry to clipboard (⌘C)"}>
                  <Button
                    size="small"
                    icon={<ScissorOutlined />}
                    onClick={() => copyEntryToClipboard(selectedEntry)}
                    style={clipboardEntry?.sourceDn === selectedEntry.dn ? { color: "#faad14" } : undefined}
                  />
                </Tooltip>
                <Tooltip title={isReadOnly ? "Read-only — lås opp i verktøylinjen for å slette" : "Slett entry"}>
                  <Button size="small" icon={<DeleteOutlined />} danger onClick={confirmDelete} disabled={isReadOnly} />
                </Tooltip>
              </>
            ) : (
              <>
                <Button size="small" type="primary" icon={<SaveOutlined />}
                  loading={saving} onClick={saveEdits}>Lagre</Button>
                <Button size="small" icon={<CloseOutlined />} onClick={cancelEdit}>Avbryt</Button>
              </>
            )}
          </Space>
        </div>
      </div>

      {/* ── ObjectClass section (collapsible, editable in edit mode) ─────────── */}
      <div style={{ borderBottom: "1px solid #f0f0f0", background: "#fff", flexShrink: 0 }}>
        {/* Header row */}
        <div
          onClick={() => setOcExpanded(!ocExpanded)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "5px 16px", cursor: "pointer", userSelect: "none",
            background: ocExpanded ? (isEditing ? "#f6ffed" : "#f0f7ff") : "#fafafa",
            borderBottom: ocExpanded ? `1px solid ${isEditing ? "#b7eb8f" : "#d6e8ff"}` : "none",
          }}
        >
          {ocExpanded
            ? <CaretDownOutlined  style={{ fontSize: 11, color: isEditing ? "#52c41a" : "#1677ff" }} />
            : <CaretRightOutlined style={{ fontSize: 11, color: "#888" }} />}
          <Text style={{ fontSize: 11, fontWeight: 600, color: ocExpanded ? (isEditing ? "#389e0d" : "#1677ff") : "#555" }}>
            objectClass
            {isEditing && <span style={{ marginLeft: 6, fontWeight: 400, color: "#52c41a", fontSize: 10 }}>✎ redigeres</span>}
          </Text>
          {!ocExpanded && (
            <span style={{ marginLeft: 4 }}>
              {currentOcs.map(oc => (
                <Tag key={oc} color={ocColor(oc)} style={{ fontSize: 10, margin: "0 2px" }}>{oc}</Tag>
              ))}
            </span>
          )}
          {ocExpanded && !isEditing && (
            <Text type="secondary" style={{ fontSize: 10, marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
              {currentOcs.length} klasser — klikk for å skjule
              <Tooltip title="Kopier alle">
                <Button type="text" size="small" icon={<CopyOutlined />}
                  style={{ fontSize: 11, padding: "0 4px", height: 18, color: "#1677ff" }}
                  onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(currentOcs.join(", ")); message.success("Kopiert!", 1); }}
                />
              </Tooltip>
            </Text>
          )}
          {ocExpanded && isEditing && (
            <Text style={{ fontSize: 10, marginLeft: "auto", color: "#389e0d" }}>
              {currentOcs.length} klasser
            </Text>
          )}
        </div>

        {/* Body */}
        {ocExpanded && (
          <div style={{ padding: "8px 16px" }}>
            {/* Tags */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: isEditing ? 8 : 0 }}>
              {currentOcs.map(oc => {
                const ocDef = schema?.objectClasses.find(o => o.name.toLowerCase() === oc.toLowerCase());
                const isStructural = ocDef?.kind === "STRUCTURAL";
                const isAdded = isEditing && !objectClasses.some(o => o.toLowerCase() === oc.toLowerCase());
                return isEditing ? (
                  <Tooltip
                    key={oc}
                    title={isStructural
                      ? `${oc} (structural) — OBS: fjerning av strukturell OC kan feile på serveren`
                      : `Fjern "${oc}"`}
                  >
                    <Tag
                      color={isAdded ? "green" : isStructural ? "blue" : ocColor(oc)}
                      closable
                      onClose={e => { e.preventDefault(); setOcEditList(prev => prev!.filter(o => o !== oc)); }}
                      style={{ fontSize: 12, padding: "2px 8px", margin: 0 }}
                    >
                      {oc}
                      {isStructural && <span style={{ marginLeft: 3, fontSize: 9, opacity: 0.7 }}>S</span>}
                      {isAdded && <span style={{ marginLeft: 3, fontSize: 9, opacity: 0.8 }}>+ny</span>}
                    </Tag>
                  </Tooltip>
                ) : (
                  <Tooltip key={oc} title={`Kopier "${oc}"`}>
                    <Tag
                      color={ocColor(oc)}
                      style={{ fontSize: 12, padding: "2px 8px", cursor: "pointer" }}
                      onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(oc); message.success(`Kopiert: ${oc}`, 1); }}
                    >
                      {oc}
                    </Tag>
                  </Tooltip>
                );
              })}
            </div>

            {/* Add objectClass autocomplete (edit mode only) */}
            {isEditing && (
              <AutoComplete
                size="small"
                options={ocOptions}
                value={ocAddInput}
                onChange={setOcAddInput}
                onSelect={(v: string) => {
                  if (!currentOcs.some(o => o.toLowerCase() === v.toLowerCase())) {
                    setOcEditList(prev => [...(prev ?? []), v]);
                  }
                  setOcAddInput("");
                }}
                filterOption={(input, opt) =>
                  (opt?.value as string ?? "").toLowerCase().includes(input.toLowerCase())
                }
                style={{ width: "100%" }}
              >
                <Input
                  size="small"
                  placeholder="+ Legg til objectClass…"
                  prefix={<PlusOutlined style={{ color: "#52c41a", fontSize: 11 }} />}
                  onPressEnter={() => {
                    const v = ocAddInput.trim();
                    if (v && !currentOcs.some(o => o.toLowerCase() === v.toLowerCase())) {
                      setOcEditList(prev => [...(prev ?? []), v]);
                    }
                    setOcAddInput("");
                  }}
                />
              </AutoComplete>
            )}
          </div>
        )}
      </div>

      {/* ── Operational toggle (view mode only) ────────────────────────────── */}
      {!isEditing && (
        <div style={{ padding: "4px 16px", background: "#fafafa", borderBottom: "1px solid #f0f0f0", flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
          <Switch size="small" checked={showOperational} onChange={setShowOperational} />
          <Text type="secondary" style={{ fontSize: 11 }}>Vis operasjonelle attributter</Text>
        </div>
      )}

      {/* ── VIEW MODE: Attribute table ──────────────────────────────────────── */}
      {!isEditing && (
        <div style={{ flex: 1, overflow: "auto" }}>
          <Table<LdapAttribute>
            dataSource={visibleAttrs}
            columns={viewColumns}
            rowKey="name"
            pagination={false}
            size="small"
            bordered={false}
            showSorterTooltip={false}
            style={{ fontSize: 12 }}
          />
        </div>
      )}

      {/* ── EDIT MODE: Inline editable fields ──────────────────────────────── */}
      {isEditing && editMap && (
        <div style={{ flex: 1, overflow: "auto", padding: "8px 12px" }}>
          {Array.from(editMap.entries()).map(([attrName, values]) => (
            <div key={attrName} style={{
              marginBottom: 8, border: "1px solid #e8e8e8", borderRadius: 6,
              overflow: "hidden",
            }}>
              {/* Attr header */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "4px 10px", background: "#fafafa", borderBottom: "1px solid #f0f0f0",
              }}>
                <Space size={4}>
                  {isPasswordAttr(attrName) && (
                    <LockOutlined style={{ fontSize: 11, color: "#722ed1" }} />
                  )}
                  <Text strong style={{ fontFamily: "monospace", fontSize: 12 }}>{attrName}</Text>
                </Space>
                <Tooltip title={`Fjern attributt "${attrName}"`}>
                  <Button type="text" size="small" danger icon={<DeleteOutlined />}
                    style={{ fontSize: 11 }} onClick={() => removeAttr(attrName)} />
                </Tooltip>
              </div>
              {/* Values */}
              <div style={{ padding: "6px 10px" }}>
                {values.map((val, idx) => {
                  const isPwd    = isPasswordAttr(attrName);
                  const hashed   = isPwd && isAlreadyHashed(val);
                  const scheme   = hashed ? extractScheme(val) : null;
                  return (
                    <div key={idx} style={{ marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {isPwd ? (
                          <Input.Password
                            size="small"
                            value={val}
                            onChange={e => updateValue(attrName, idx, e.target.value)}
                            style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }}
                            placeholder="Skriv inn nytt passord (klartekst)"
                          />
                        ) : (
                          <Input
                            size="small"
                            value={val}
                            onChange={e => updateValue(attrName, idx, e.target.value)}
                            style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }}
                          />
                        )}
                        <Tooltip title="Fjern verdi">
                          <Button type="text" size="small" danger icon={<CloseOutlined />}
                            onClick={() => removeValue(attrName, idx)} />
                        </Tooltip>
                      </div>
                      {/* Password status row */}
                      {isPwd && val.trim() !== "" && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                          {hashed ? (
                            <Tag color="green" style={{ fontSize: 10 }}>
                              ✓ Allerede hashet {scheme ? `{${scheme}}` : ""}– sendes uendret
                            </Tag>
                          ) : (
                            <>
                              <Tag color="orange" style={{ fontSize: 10 }}>
                                Vil bli hashet ved lagring:
                              </Tag>
                              <Select
                                size="small"
                                value={hashScheme}
                                onChange={setHashScheme}
                                options={HASH_SCHEME_OPTIONS}
                                style={{ width: 180 }}
                              />
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                <Button type="dashed" size="small" icon={<PlusOutlined />}
                  style={{ fontSize: 11, marginTop: 2 }}
                  onClick={() => addValue(attrName)}>
                  Legg til verdi
                </Button>
              </div>
            </div>
          ))}

          {/* ── Schema completeness hints ───────────────────────────────────── */}
          {(schemaMustMissing.length > 0 || schemaMayMissing.length > 0) && (
            <div style={{
              margin: "10px 0 8px",
              border: "1px solid #d3adf7",
              borderRadius: 6,
              overflow: "hidden",
              background: "#f9f0ff",
            }}>
              <div
                onClick={() => setSchemaHintsExpanded(v => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "5px 10px", cursor: "pointer", userSelect: "none",
                  background: "#f0e6ff",
                  borderBottom: schemaHintsExpanded ? "1px solid #d3adf7" : "none",
                }}
              >
                {schemaHintsExpanded
                  ? <CaretDownOutlined  style={{ fontSize: 10, color: "#722ed1" }} />
                  : <CaretRightOutlined style={{ fontSize: 10, color: "#722ed1" }} />}
                <BookOutlined style={{ fontSize: 12, color: "#722ed1" }} />
                <Text style={{ fontSize: 11, fontWeight: 600, color: "#531dab" }}>
                  Schema-komplettering (objectClass)
                </Text>
                <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                  {schemaMustMissing.length > 0 && (
                    <Tag color="red" style={{ fontSize: 10 }}>
                      {schemaMustMissing.length} MUST
                    </Tag>
                  )}
                  {schemaMayMissing.length > 0 && (
                    <Tag color="purple" style={{ fontSize: 10 }}>
                      {schemaMayMissing.length} MAY
                    </Tag>
                  )}
                </div>
              </div>

              {schemaHintsExpanded && (
                <div style={{ padding: "8px 10px" }}>
                  {/* MUST missing — schema violations */}
                  {schemaMustMissing.length > 0 && (
                    <div style={{ marginBottom: schemaMayMissing.length > 0 ? 8 : 0 }}>
                      <Text style={{ fontSize: 11, color: "#cf1322", fontWeight: 600, display: "block", marginBottom: 4 }}>
                        Påkrevd av schema (MUST):
                      </Text>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {schemaMustMissing.map(attr => (
                          <Tooltip key={attr} title={`Påkrevd av objectClass — klikk for å legge til`}>
                            <Tag
                              color="red"
                              style={{ cursor: "pointer", fontSize: 11, margin: 0, fontFamily: "monospace" }}
                              onClick={() => addSuggestedAttr(attr)}
                            >
                              <PlusOutlined style={{ fontSize: 9, marginRight: 2 }} />
                              {attr}
                              <Tag color="red" style={{ marginLeft: 4, fontSize: 9, padding: "0 3px", lineHeight: "14px" }}>MUST</Tag>
                            </Tag>
                          </Tooltip>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* MAY missing — optional but defined */}
                  {schemaMayMissing.length > 0 && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 4 }}>
                        Valgfri iflg. schema (MAY) — klikk for å legge til:
                      </Text>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {schemaMayMissing.map(attr => (
                          <Tooltip key={attr} title={`Valgfritt attributt definert av objectClass — klikk for å legge til`}>
                            <Tag
                              color="purple"
                              style={{ cursor: "pointer", fontSize: 11, margin: 0, fontFamily: "monospace" }}
                              onClick={() => addSuggestedAttr(attr)}
                            >
                              <PlusOutlined style={{ fontSize: 9, marginRight: 2 }} />
                              {attr}
                            </Tag>
                          </Tooltip>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Sibling attribute hints ─────────────────────────────────────── */}
          {(siblingLoading || (siblingAnalysis && siblingAnalysis.sampleCount > 0)) && (() => {
            // Compute attributes present in siblings but missing from current editMap
            const missingAttrs = siblingAnalysis
              ? siblingAnalysis.attributes.filter(
                  a => !editMap.has(a.name) && a.name !== "objectClass"
                )
              : [];

            return (
              <div style={{
                margin: "10px 0 8px",
                border: "1px solid #ffe58f",
                borderRadius: 6,
                overflow: "hidden",
                background: "#fffbe6",
              }}>
                {/* Hints header */}
                <div
                  onClick={() => setHintsExpanded(!hintsExpanded)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "5px 10px", cursor: "pointer", userSelect: "none",
                    background: "#fff7e6", borderBottom: hintsExpanded ? "1px solid #ffe58f" : "none",
                  }}
                >
                  {hintsExpanded
                    ? <CaretDownOutlined style={{ fontSize: 10, color: "#fa8c16" }} />
                    : <CaretRightOutlined style={{ fontSize: 10, color: "#fa8c16" }} />}
                  <BulbOutlined style={{ fontSize: 12, color: "#fa8c16" }} />
                  <Text style={{ fontSize: 11, fontWeight: 600, color: "#d46b08" }}>
                    {siblingLoading
                      ? "Analyserer søsken-entries…"
                      : `Attributter brukt av søsken (${siblingAnalysis!.sampleCount} entries)`}
                  </Text>
                  {!siblingLoading && missingAttrs.length > 0 && (
                    <Tag color="orange" style={{ fontSize: 10, marginLeft: "auto" }}>
                      {missingAttrs.length} mangler
                    </Tag>
                  )}
                </div>

                {hintsExpanded && (
                  <div style={{ padding: "8px 10px" }}>
                    {siblingLoading ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Spin size="small" />
                        <Text type="secondary" style={{ fontSize: 11 }}>Laster analyse…</Text>
                      </div>
                    ) : missingAttrs.length === 0 ? (
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        ✅ Denne entry har alle attributter som finnes i søsken-entries!
                      </Text>
                    ) : (
                      <>
                        <Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 6 }}>
                          Klikk for å legge til manglende attributt:
                        </Text>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {missingAttrs.map(item => {
                            const pct = Math.round((item.count / siblingAnalysis!.sampleCount) * 100);
                            // Colour-code by frequency
                            const color = pct >= 90 ? "red" : pct >= 60 ? "orange" : pct >= 30 ? "gold" : "default";
                            return (
                              <Tooltip
                                key={item.name}
                                title={`Finnes i ${item.count}/${siblingAnalysis!.sampleCount} entries (${pct}%) — klikk for å legge til`}
                              >
                                <Tag
                                  color={color}
                                  style={{
                                    cursor: "pointer", fontSize: 11, margin: 0,
                                    fontFamily: "monospace",
                                  }}
                                  onClick={() => addSuggestedAttr(item.name)}
                                >
                                  <PlusOutlined style={{ fontSize: 9, marginRight: 2 }} />
                                  {item.name}
                                  <span style={{ marginLeft: 4, opacity: 0.75, fontSize: 10 }}>
                                    {pct}%
                                  </span>
                                </Tag>
                              </Tooltip>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Add new attribute */}
          {showNewAttr ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
              <AutoComplete
                size="small"
                options={attrOptions}
                value={newAttrName}
                onChange={setNewAttrName}
                onSelect={(v) => { setNewAttrName(v); }}
                filterOption={(input, opt) =>
                  (opt?.value as string ?? "").toLowerCase().includes(input.toLowerCase())
                }
                style={{ flex: 1 }}
                placeholder="Attributtnavn (f.eks. mail)"
                autoFocus
              />
              <Button size="small" type="primary" onClick={confirmAddAttr}>OK</Button>
              <Button size="small" onClick={() => { setShowNewAttr(false); setNewAttrName(""); }}>Avbryt</Button>
            </div>
          ) : (
            <Button type="dashed" size="small" icon={<PlusOutlined />}
              style={{ marginTop: 4, width: "100%" }}
              onClick={() => setShowNewAttr(true)}>
              Nytt attributt
            </Button>
          )}
        </div>
      )}
    </div>
    {renameOpen && selectedEntry && (
      <RenameEntryModal
        open={renameOpen}
        dn={selectedEntry.dn}
        onClose={() => setRenameOpen(false)}
        onRenamed={() => setRenameOpen(false)}
      />
    )}
    </>
  );
};

export default EntryDetails;
