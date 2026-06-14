import React, { useState, useEffect, useMemo } from "react";
import {
  Drawer, Form, Input, AutoComplete, Button, Tag,
  Typography, Space, Divider, message, Spin, Tooltip, Select,
} from "antd";
import {
  PlusOutlined, DeleteOutlined, ThunderboltOutlined,
  ReloadOutlined, BookOutlined, CaretDownOutlined, CaretRightOutlined,
  LockOutlined, CopyOutlined,
} from "@ant-design/icons";
import { v4 as uuidv4 } from "uuid";
import { useAppStore } from "../store/appStore";
import * as api from "../api/commands";
import { collectOcAttrs } from "../utils/schema";
import {
  isPasswordAttr, isAlreadyHashed,
  hashLdapPassword, HASH_SCHEME_OPTIONS, type HashScheme,
} from "../utils/ldapPassword";
import type { LdapMod, SiblingAnalysis, RdnPattern, ClipboardEntry } from "../types";

const { Text } = Typography;

interface Props {
  open:      boolean;
  parentDn:  string;
  onClose:   () => void;
  onCreated: (dn: string) => void;
  /** If provided, pre-fill the form with this clipboard content */
  prefill?: ClipboardEntry | null;
}

const NewEntryDrawer: React.FC<Props> = ({ open, parentDn: initialParent, onClose, onCreated, prefill }) => {
  const { schema, addEntry } = useAppStore();

  const [parentDn,    setParentDn]    = useState(initialParent);
  const [rdnAttr,     setRdnAttr]     = useState("cn");
  const [rdnValue,    setRdnValue]    = useState("");
  const [selectedOcs, setSelectedOcs] = useState<string[]>([]);
  const [ocInput,     setOcInput]     = useState("");
  const [attrValues,  setAttrValues]  = useState<Map<string, string>>(new Map());
  const [submitting,  setSubmitting]  = useState(false);

  // Sibling analysis state
  const [analysis,            setAnalysis]            = useState<SiblingAnalysis | null>(null);
  const [analysisLoading,     setAnalysisLoading]     = useState(false);
  const [schemaHintsExpanded, setSchemaHintsExpanded] = useState(true);

  // Password hashing
  const [hashScheme, setHashScheme] = useState<HashScheme>("SSHA512");

  // Reset + auto-analyze when opened
  useEffect(() => {
    if (open) {
      setParentDn(initialParent);
      if (prefill) {
        // Pre-fill from clipboard
        setRdnAttr(prefill.rdnAttr);
        setRdnValue("");  // user must provide a unique new RDN value
        setSelectedOcs([...prefill.objectClasses]);
        const m = new Map<string, string>();
        for (const { name, value } of prefill.attrs) m.set(name, value);
        setAttrValues(m);
        setAnalysis(null);
        // Still run analysis so frequency hints are available
        runAnalysis(initialParent);
      } else {
        setRdnAttr("cn");
        setRdnValue("");
        setSelectedOcs([]);
        setOcInput("");
        setAttrValues(new Map());
        setAnalysis(null);
        runAnalysis(initialParent);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialParent]);

  const runAnalysis = async (dn: string) => {
    if (!dn.trim()) return;
    setAnalysisLoading(true);
    setAnalysis(null);
    try {
      const result = await api.analyzeSiblings(dn, 25);
      setAnalysis(result);
      // Auto-apply the top RDN pattern
      if (result.rdnPatterns.length > 0) {
        const top = result.rdnPatterns[0];
        setRdnAttr(top.attr);
        // If UUID, pre-generate a value
        if (top.valueType === "UUID") {
          setRdnValue(uuidv4());
        }
      }
    } catch {
      // silently ignore — analysis is optional
    } finally {
      setAnalysisLoading(false);
    }
  };

  // Apply full pattern from analysis
  const applyPattern = () => {
    if (!analysis) return;
    const topOcs = analysis.objectClasses
      .filter(i => i.count / analysis.sampleCount >= 0.5) // present in ≥50% of entries
      .map(i => i.name);
    if (topOcs.length > 0) setSelectedOcs(topOcs);

    // Pre-fill attrs that appear in most entries (≥80%), skip objectClass + rdn
    const topAttrs = analysis.attributes
      .filter(i => i.count / analysis.sampleCount >= 0.8 && i.name !== rdnAttr)
      .map(i => i.name);
    setAttrValues(prev => {
      const m = new Map(prev);
      for (const attr of topAttrs) {
        if (!m.has(attr)) m.set(attr, "");
      }
      return m;
    });
    message.success(`Added ${topOcs.length} objectClasses and ${topAttrs.length} attributes`);
  };

  const previewDn = rdnValue.trim()
    ? `${rdnAttr}=${rdnValue.trim()},${parentDn}`
    : "";

  // Compute must/may attrs from selected objectClasses (recursive through superior chain)
  const { mustAttrs, mayAttrs } = useMemo(() => {
    if (!schema || selectedOcs.length === 0)
      return { mustAttrs: new Set<string>(), mayAttrs: new Set<string>() };
    const { must, may } = collectOcAttrs(selectedOcs, schema);
    must.add(rdnAttr);
    must.delete("objectClass");
    may.delete("objectClass");
    may.delete(rdnAttr);
    return { mustAttrs: must, mayAttrs: may };
  }, [schema, selectedOcs, rdnAttr]);

  const shownAttrs = useMemo(() => {
    const all = new Set([...mustAttrs, ...attrValues.keys()]);
    return Array.from(all).sort((a, b) => {
      const aM = mustAttrs.has(a), bM = mustAttrs.has(b);
      if (aM && !bM) return -1;
      if (!aM && bM) return 1;
      return a.localeCompare(b);
    });
  }, [mustAttrs, attrValues]);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  // Get current RDN pattern from analysis (if matches current rdnAttr)
  const activeRdnPattern: RdnPattern | undefined = useMemo(() =>
    analysis?.rdnPatterns.find(p => p.attr.toLowerCase() === rdnAttr.toLowerCase()),
  [analysis, rdnAttr]);

  const rdnValueTypeLabel = (p: RdnPattern): string => {
    switch (p.valueType) {
      case "UUID":      return "UUID";
      case "NUMBER":    return "Number";
      case "EMAIL":     return "Email";
      case "DN":        return "DN";
      case "FREE_TEXT": return "Text";
    }
  };

  const addOc = (oc: string) => {
    const t = oc.trim();
    if (t && !selectedOcs.includes(t)) setSelectedOcs(prev => [...prev, t]);
    setOcInput("");
  };

  const setAttr = (name: string, val: string) =>
    setAttrValues(prev => { const m = new Map(prev); m.set(name, val); return m; });

  const removeOptionalAttr = (name: string) =>
    setAttrValues(prev => { const m = new Map(prev); m.delete(name); return m; });

  const addOptionalAttr = (name: string) => {
    if (!name.trim() || shownAttrs.includes(name.trim())) return;
    setAttrValues(prev => { const m = new Map(prev); m.set(name.trim(), ""); return m; });
  };

  // ── Submit ───────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!rdnValue.trim())         { message.error("RDN value is required"); return; }
    if (!parentDn.trim())          { message.error("Parent DN is required"); return; }
    if (selectedOcs.length === 0)  { message.error("At least one objectClass is required"); return; }

    for (const attr of mustAttrs) {
      if (attr === rdnAttr) continue;
      if (!(attrValues.get(attr) ?? "").trim()) {
        message.error(`Required attribute "${attr}" is missing a value`);
        return;
      }
    }

    const dn = `${rdnAttr}=${rdnValue.trim()},${parentDn}`;
    const attrs: LdapMod[] = [
      { op: "ADD", attr: "objectClass", values: selectedOcs },
      { op: "ADD", attr: rdnAttr,       values: [rdnValue.trim()] },
    ];
    for (const [name, val] of attrValues) {
      if (name === rdnAttr) continue;
      if (val.trim()) attrs.push({ op: "ADD", attr: name, values: [val.trim()] });
    }

    // Hash any plain-text password values
    const processedAttrs = await Promise.all(
      attrs.map(async mod => {
        if (!isPasswordAttr(mod.attr)) return mod;
        const hashedValues = await Promise.all(
          mod.values.map(v =>
            isAlreadyHashed(v) ? Promise.resolve(v) : hashLdapPassword(v, hashScheme)
          )
        );
        return { ...mod, values: hashedValues };
      })
    );

    setSubmitting(true);
    try {
      await addEntry({ dn, attributes: processedAttrs });
      message.success("Entry created");
      onCreated(dn);
      onClose();
    } catch (e) {
      message.error(`Error: ${e}`);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Autocomplete options ────────────────────────────────────────────────────

  const ocOptions = (schema?.objectClasses ?? [])
    .filter(o => !selectedOcs.includes(o.name))
    .map(o => ({ value: o.name }));

  const attrOptions = (schema?.attributeTypes ?? [])
    .filter(a => !shownAttrs.includes(a.name))
    .map(a => ({ value: a.name }));

  const rdnAttrOptions = (schema?.attributeTypes ?? []).map(a => ({ value: a.name }));

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Drawer
      title={<span><PlusOutlined style={{ marginRight: 8, color: "#1677ff" }} />Create new entry</span>}
      placement="right"
      width={460}
      open={open}
      onClose={onClose}
      footer={
        <div style={{ textAlign: "right" }}>
          <Space>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="primary" loading={submitting} onClick={handleSubmit}>
              Create entry
            </Button>
          </Space>
        </div>
      }
    >
      <Form layout="vertical" size="small">

        {/* ── Clipboard prefill banner ───────────────────────────────────── */}
        {prefill && (
          <div style={{
            marginBottom: 12, padding: "8px 12px",
            background: "#fffbe6", border: "1px solid #ffe58f", borderRadius: 6,
            display: "flex", alignItems: "flex-start", gap: 8,
          }}>
            <CopyOutlined style={{ color: "#d48806", marginTop: 2, flexShrink: 0 }} />
            <div>
              <Text style={{ fontSize: 12, fontWeight: 600, color: "#d48806" }}>Pasting from clipboard</Text>
              <br />
              <Text code style={{ fontSize: 11, wordBreak: "break-all" }}>{prefill.sourceDn}</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 11 }}>
                {prefill.objectClasses.length} objectClasses · {prefill.attrs.length} attributes copied
                {" · "}passwords and unique attributes excluded
              </Text>
            </div>
          </div>
        )}

        {/* ── Parent DN ─────────────────────────────────────────────────── */}
        <Form.Item label="Parent DN">
          <Space.Compact style={{ width: "100%" }}>
            <Input
              value={parentDn}
              onChange={e => setParentDn(e.target.value)}
              style={{ fontFamily: "monospace", fontSize: 12 }}
            />
            <Tooltip title="Re-analyze existing entries">
              <Button
                icon={<ReloadOutlined />}
                loading={analysisLoading}
                onClick={() => runAnalysis(parentDn)}
              />
            </Tooltip>
          </Space.Compact>
        </Form.Item>

        {/* ── Sibling analysis ──────────────────────────────────────────── */}
        {(analysisLoading || analysis) && (
          <div style={{
            marginBottom: 12, padding: "10px 12px",
            background: "#f0f7ff", border: "1px solid #91caff", borderRadius: 6,
          }}>
            {analysisLoading ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Spin size="small" />
                <Text style={{ fontSize: 12, color: "#1677ff" }}>Analyzing existing entries…</Text>
              </div>
            ) : analysis && analysis.sampleCount > 0 ? (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <Text style={{ fontSize: 12, fontWeight: 600, color: "#1677ff" }}>
                    <ThunderboltOutlined style={{ marginRight: 4 }} />
                    Pattern from {analysis.sampleCount} existing entries
                  </Text>
                  <Tooltip title="Automatically add most common objectClasses and attributes">
                    <Button
                      size="small" type="primary" ghost
                      icon={<ThunderboltOutlined />}
                      onClick={applyPattern}
                    >
                      Apply pattern
                    </Button>
                  </Tooltip>
                </div>

                {/* ObjectClass frequencies */}
                <div style={{ marginBottom: 6 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>ObjectClasses:</Text>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 3 }}>
                    {analysis.objectClasses.slice(0, 10).map(item => {
                      const pct = Math.round((item.count / analysis.sampleCount) * 100);
                      const alreadySelected = selectedOcs.includes(item.name);
                      return (
                        <Tooltip key={item.name} title={`${item.count}/${analysis.sampleCount} entries (${pct}%)`}>
                          <Tag
                            color={alreadySelected ? "blue" : "default"}
                            style={{ cursor: alreadySelected ? "default" : "pointer", fontSize: 11, margin: 0 }}
                            onClick={() => !alreadySelected && addOc(item.name)}
                          >
                            {item.name}
                            <span style={{ marginLeft: 4, opacity: 0.7, fontSize: 10 }}>{pct}%</span>
                          </Tag>
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>

                {/* Top attribute frequencies as small bars */}
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>Most common attributes:</Text>
                  <div style={{ marginTop: 3, display: "flex", flexWrap: "wrap", gap: 3 }}>
                    {analysis.attributes.slice(0, 12).map(item => {
                      const pct = Math.round((item.count / analysis.sampleCount) * 100);
                      const alreadyShown = shownAttrs.includes(item.name);
                      return (
                        <Tooltip key={item.name} title={`${item.count}/${analysis.sampleCount} entries (${pct}%) — click to add`}>
                          <Tag
                            color={alreadyShown ? "green" : "default"}
                            style={{
                              cursor: alreadyShown ? "default" : "pointer",
                              fontSize: 10, margin: 0, fontFamily: "monospace",
                            }}
                            onClick={() => !alreadyShown && addOptionalAttr(item.name)}
                          >
                            {item.name} <span style={{ opacity: 0.6 }}>{pct}%</span>
                          </Tag>
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>

                {/* RDN patterns */}
                {analysis.rdnPatterns.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>RDN patterns:</Text>
                    <div style={{ marginTop: 3, display: "flex", flexWrap: "wrap", gap: 3 }}>
                      {analysis.rdnPatterns.slice(0, 5).map(p => {
                        const pct = Math.round((p.count / analysis.sampleCount) * 100);
                        const typeColors: Record<string, string> = {
                          UUID: "purple", NUMBER: "orange", EMAIL: "cyan",
                          DN: "gold", FREE_TEXT: "default",
                        };
                        const isActive = rdnAttr.toLowerCase() === p.attr.toLowerCase();
                        return (
                          <Tooltip
                            key={p.attr}
                            title={`${p.attr}=<${p.valueType.toLowerCase()}> — used by ${pct}% (ex: ${p.example})`}
                          >
                            <Tag
                              color={isActive ? typeColors[p.valueType] ?? "default" : "default"}
                              style={{ cursor: "pointer", fontSize: 10, margin: 0 }}
                              onClick={() => {
                                setRdnAttr(p.attr);
                                if (p.valueType === "UUID") setRdnValue(uuidv4());
                              }}
                            >
                              <span style={{ fontFamily: "monospace" }}>{p.attr}</span>
                              <span style={{ margin: "0 2px", opacity: 0.6 }}>=</span>
                              {p.valueType === "UUID" ? "UUID" :
                               p.valueType === "NUMBER" ? "Number" :
                               p.valueType === "EMAIL" ? "Email" :
                               p.valueType === "DN" ? "DN" : "Text"}
                              <span style={{ marginLeft: 3, opacity: 0.6 }}>{pct}%</span>
                            </Tag>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : analysis && analysis.sampleCount === 0 ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                No existing entries found — manual creation
              </Text>
            ) : null}
          </div>
        )}

        {/* ── RDN ──────────────────────────────────────────────────────── */}
        <Form.Item label={
          <span>
            RDN <Text type="secondary" style={{ fontSize: 11 }}>(relative DN)</Text>
            {activeRdnPattern && (
              <Tag
                color="geekblue"
                style={{ marginLeft: 8, fontSize: 10, lineHeight: "16px", padding: "0 4px" }}
              >
                {rdnValueTypeLabel(activeRdnPattern)}
                {" · "}
                <span style={{ opacity: 0.75 }}>ex: {activeRdnPattern.example.length > 20
                  ? activeRdnPattern.example.slice(0, 20) + "…"
                  : activeRdnPattern.example}
                </span>
              </Tag>
            )}
          </span>
        }>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <AutoComplete
              options={rdnAttrOptions}
              value={rdnAttr}
              onChange={setRdnAttr}
              filterOption={(input, opt) =>
                (opt?.value as string ?? "").toLowerCase().includes(input.toLowerCase())
              }
              style={{ width: 110 }}
            >
              <Input style={{ fontFamily: "monospace" }} />
            </AutoComplete>
            <Text style={{ padding: "0 2px" }}>=</Text>
            <Input
              placeholder={activeRdnPattern?.valueType === "UUID" ? "UUID" : "value"}
              value={rdnValue}
              onChange={e => setRdnValue(e.target.value)}
              style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }}
            />
            {activeRdnPattern?.valueType === "UUID" && (
              <Tooltip title="Generate new UUID">
                <Button
                  size="small"
                  onClick={() => setRdnValue(uuidv4())}
                  style={{ fontSize: 14, padding: "0 6px" }}
                >
                  🎲
                </Button>
              </Tooltip>
            )}
          </div>
        </Form.Item>

        {/* DN preview */}
        {previewDn && (
          <div style={{ marginBottom: 12, padding: "6px 10px", background: "#f6ffed",
                        border: "1px solid #b7eb8f", borderRadius: 6 }}>
            <Text style={{ fontSize: 11, color: "#52c41a" }}>DN: </Text>
            <Text code style={{ fontSize: 11 }}>{previewDn}</Text>
          </div>
        )}

        <Divider style={{ margin: "4px 0 12px" }} />

        {/* ── ObjectClasses ─────────────────────────────────────────────── */}
        <Form.Item label="ObjectClass *">
          <div style={{ marginBottom: 6, display: "flex", flexWrap: "wrap", gap: 4, minHeight: 28 }}>
            {selectedOcs.map(oc => (
              <Tag key={oc} closable onClose={() => setSelectedOcs(prev => prev.filter(o => o !== oc))}
                   style={{ margin: 0 }}>
                {oc}
              </Tag>
            ))}
          </div>
          <AutoComplete
            options={ocOptions}
            value={ocInput}
            onChange={setOcInput}
            onSelect={(v) => addOc(v)}
            filterOption={(input, opt) =>
              (opt?.value as string ?? "").toLowerCase().includes(input.toLowerCase())
            }
            style={{ width: "100%" }}
          >
            <Input placeholder="Search and select objectClass…" onPressEnter={() => addOc(ocInput)} />
          </AutoComplete>
        </Form.Item>

        <Divider style={{ margin: "4px 0 12px" }} />

        {/* ── Attributes ───────────────────────────────────────────────── */}
        <Form.Item label={
          <span>Attributes&nbsp;
            <Text type="secondary" style={{ fontSize: 11 }}>(* = required)</Text>
          </span>
        }>
          {shownAttrs.map(attrName => {
            if (attrName === rdnAttr) return null;
            const isMust = mustAttrs.has(attrName);
            const isPwd  = isPasswordAttr(attrName);
            const val    = attrValues.get(attrName) ?? "";
            const alreadyHashed = isPwd && isAlreadyHashed(val);
            // find frequency hint from analysis
            const freq = analysis?.attributes.find(a => a.name === attrName);
            return (
              <div key={attrName} style={{ marginBottom: isPwd ? 10 : 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Tooltip title={freq ? `Used in ${Math.round(freq.count / analysis!.sampleCount * 100)}% of entries` : undefined}>
                    <Text style={{
                      fontFamily: "monospace", fontSize: 12,
                      width: 130, flexShrink: 0,
                      color: isMust ? "#d4380d" : "#555",
                    }}>
                      {isPwd && <LockOutlined style={{ fontSize: 10, marginRight: 3, color: "#722ed1" }} />}
                      {isMust ? "* " : "  "}{attrName}
                      {freq && !isMust && (
                        <span style={{ marginLeft: 4, fontSize: 10, color: "#aaa" }}>
                          {Math.round(freq.count / analysis!.sampleCount * 100)}%
                        </span>
                      )}
                    </Text>
                  </Tooltip>
                  {isPwd ? (
                    <Input.Password
                      size="small"
                      value={val}
                      onChange={e => setAttr(attrName, e.target.value)}
                      style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }}
                      placeholder="Enter password (plain text)"
                      status={isMust && !val.trim() ? "error" : undefined}
                    />
                  ) : (
                    <Input
                      size="small"
                      value={val}
                      onChange={e => setAttr(attrName, e.target.value)}
                      style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }}
                      placeholder={isMust ? "Required" : "Optional"}
                      status={isMust && !val.trim() ? "error" : undefined}
                    />
                  )}
                  {!isMust && (
                    <Button type="text" size="small" danger icon={<DeleteOutlined />}
                      onClick={() => removeOptionalAttr(attrName)} />
                  )}
                </div>
                {/* Password hash status */}
                {isPwd && val.trim() !== "" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, paddingLeft: 136 }}>
                    {alreadyHashed ? (
                      <Tag color="green" style={{ fontSize: 10 }}>✓ Already hashed – sent as-is</Tag>
                    ) : (
                      <>
                        <Tag color="orange" style={{ fontSize: 10 }}>Will be hashed:</Tag>
                        <Select
                          size="small"
                          value={hashScheme}
                          onChange={setHashScheme}
                          options={HASH_SCHEME_OPTIONS}
                          style={{ width: 185 }}
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* ── Schema MAY attrs hint panel ──────────────────────────────── */}
          {selectedOcs.length > 0 && (() => {
            const unusedMay = Array.from(mayAttrs)
              .filter(a => a !== rdnAttr && !attrValues.has(a) && !mustAttrs.has(a))
              .sort();
            if (unusedMay.length === 0) return (
              <div style={{ marginBottom: 6 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  ✅ All optional schema attributes have been added
                </Text>
              </div>
            );
            return (
              <div style={{
                marginBottom: 8, border: "1px solid #d3adf7",
                borderRadius: 6, overflow: "hidden", background: "#f9f0ff",
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
                    Optional schema attributes (MAY)
                  </Text>
                  <Tag color="purple" style={{ fontSize: 10, marginLeft: "auto" }}>
                    {unusedMay.length} available
                  </Tag>
                </div>
                {schemaHintsExpanded && (
                  <div style={{ padding: "6px 10px" }}>
                    <Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 5 }}>
                      Defined by selected objectClasses — click to add:
                    </Text>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {unusedMay.map(a => {
                        const freq = analysis?.attributes.find(x => x.name === a);
                        const pct  = freq && analysis ? Math.round(freq.count / analysis.sampleCount * 100) : null;
                        return (
                          <Tooltip
                            key={a}
                            title={pct != null
                              ? `Optional (MAY) — used in ${pct}% of sibling entries`
                              : "Optional (MAY) — defined by objectClass"}
                          >
                            <Tag
                              color="purple"
                              style={{ cursor: "pointer", fontSize: 11, margin: 0, fontFamily: "monospace" }}
                              onClick={() => addOptionalAttr(a)}
                            >
                              <PlusOutlined style={{ fontSize: 9, marginRight: 2 }} />
                              {a}
                              {pct != null && (
                                <span style={{ marginLeft: 4, opacity: 0.65, fontSize: 10 }}>
                                  {pct}%
                                </span>
                              )}
                            </Tag>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Free-form add */}
          <AutoComplete
            options={attrOptions}
            filterOption={(input, opt) =>
              (opt?.value as string ?? "").toLowerCase().includes(input.toLowerCase())
            }
            onSelect={(v) => addOptionalAttr(v)}
            style={{ width: "100%", marginTop: 4 }}
          >
            <Input size="small" placeholder="+ Add attribute…"
              prefix={<PlusOutlined style={{ color: "#aaa" }} />} />
          </AutoComplete>
        </Form.Item>

      </Form>
    </Drawer>
  );
};

export default NewEntryDrawer;
