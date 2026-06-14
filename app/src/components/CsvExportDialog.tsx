import React, { useState, useMemo } from "react";
import {
  Modal, Form, Input, Select, Switch, Button, Space, Typography,
  InputNumber, Alert, Tag, Checkbox, message, Tooltip,
} from "antd";
import {
  DownloadOutlined, TableOutlined, ArrowUpOutlined, ArrowDownOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import * as XLSX from "xlsx";
import { save as dialogSave } from "@tauri-apps/plugin-dialog";
import { writeTextFile, writeFile } from "@tauri-apps/plugin-fs";
import { useAppStore } from "../store/appStore";
import * as api from "../api/commands";
import type { LdapEntry } from "../types";
import DnPickerButton from "./DnPickerButton";

const { Text } = Typography;

// ─── Helpers ─────────────────────────────────────────────────────────────────


/** Collect all unique attribute names across all entries, sorted. */
function collectAttrNames(entries: LdapEntry[]): string[] {
  const names = new Set<string>();
  for (const e of entries) {
    for (const a of e.attributes) names.add(a.name);
  }
  return Array.from(names).sort();
}

/** Get value for one attribute from an entry, joining multi-values. */
function getAttrValue(entry: LdapEntry, attrName: string, multiDelim: string): string {
  const attr = entry.attributes.find(a => a.name === attrName);
  if (!attr || attr.values.length === 0) return "";
  return attr.values.join(multiDelim);
}

/** Convert entries + column list to a 2D array (header + rows). */
function buildGrid(
  entries: LdapEntry[],
  columns: string[],
  includeDn: boolean,
  multiDelim: string,
): (string | number)[][] {
  const header: string[] = includeDn ? ["dn", ...columns] : columns;
  const rows = entries.map(e => {
    const row: string[] = includeDn ? [e.dn] : [];
    for (const col of columns) {
      row.push(getAttrValue(e, col, multiDelim));
    }
    return row;
  });
  return [header, ...rows];
}

function generateCsv(grid: (string | number)[][]): string {
  return grid.map(row =>
    row.map(cell => {
      const s = String(cell);
      // Quote if contains comma, quote, or newline
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    }).join(",")
  ).join("\n");
}

// ─── Column selector component ───────────────────────────────────────────────

interface ColSelectorProps {
  available: string[];
  selected: string[];
  onChange: (cols: string[]) => void;
}

const ColumnSelector: React.FC<ColSelectorProps> = ({ available, selected, onChange }) => {
  const [search, setSearch] = useState("");

  const filtered = available.filter(n =>
    !search || n.toLowerCase().includes(search.toLowerCase())
  );

  const move = (col: string, dir: -1 | 1) => {
    const idx = selected.indexOf(col);
    if (idx < 0) return;
    const next = [...selected];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  };

  const toggle = (col: string) => {
    if (selected.includes(col)) {
      onChange(selected.filter(c => c !== col));
    } else {
      onChange([...selected, col]);
    }
  };

  const selectAll = () => onChange(available);
  const clearAll  = () => onChange([]);

  return (
    <div style={{ display: "flex", gap: 8, height: 240 }}>
      {/* Available columns */}
      <div style={{ flex: 1, border: "1px solid #d9d9d9", borderRadius: 4, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "4px 8px", background: "#fafafa", borderBottom: "1px solid #f0f0f0", fontSize: 11 }}>
          <span style={{ color: "#888" }}>Available attributes</span>
          <Button type="link" size="small" style={{ float: "right", fontSize: 11, padding: 0 }} onClick={selectAll}>Select all</Button>
        </div>
        <Input
          size="small" placeholder="Search…" value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ margin: "4px 6px", width: "calc(100% - 12px)" }}
        />
        <div style={{ flex: 1, overflow: "auto", padding: "0 4px" }}>
          {filtered.map(col => (
            <div key={col} style={{ display: "flex", alignItems: "center", padding: "1px 4px", cursor: "pointer" }}
              onClick={() => toggle(col)}>
              <Checkbox checked={selected.includes(col)} style={{ marginRight: 6 }} />
              <Text style={{ fontFamily: "monospace", fontSize: 11 }}>{col}</Text>
            </div>
          ))}
        </div>
      </div>

      {/* Selected columns (ordered) */}
      <div style={{ flex: 1, border: "1px solid #d9d9d9", borderRadius: 4, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "4px 8px", background: "#fafafa", borderBottom: "1px solid #f0f0f0", fontSize: 11 }}>
          <span style={{ color: "#888" }}>Selected columns ({selected.length})</span>
          <Button type="link" size="small" style={{ float: "right", fontSize: 11, padding: 0 }} onClick={clearAll}>Remove all</Button>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "0 4px" }}>
          {selected.map((col, idx) => (
            <div key={col} style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 4px" }}>
              <Text style={{ fontFamily: "monospace", fontSize: 11, flex: 1 }}>{col}</Text>
              <Tooltip title="Move up">
                <Button type="text" size="small" disabled={idx === 0}
                  icon={<ArrowUpOutlined />} onClick={() => move(col, -1)} style={{ padding: "0 2px" }} />
              </Tooltip>
              <Tooltip title="Move down">
                <Button type="text" size="small" disabled={idx === selected.length - 1}
                  icon={<ArrowDownOutlined />} onClick={() => move(col, 1)} style={{ padding: "0 2px" }} />
              </Tooltip>
              <Button type="text" size="small" danger
                icon={<DeleteOutlined />} onClick={() => toggle(col)} style={{ padding: "0 2px" }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── Export dialog ────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  /** If provided, skip the fetch step and export these entries directly */
  entries?: LdapEntry[];
}

interface ExportForm {
  baseDn:             string;
  filter:             string;
  scope:              string;
  includeOperational: boolean;
  maxEntries:         number;
  limitAll:           boolean;
  includeDn:          boolean;
  multiDelim:         string;
}

const DEFAULT_PRIORITY_COLS = [
  "cn", "sn", "givenName", "uid", "mail", "telephoneNumber",
  "mobile", "title", "ou", "departmentNumber", "employeeNumber",
  "displayName", "description",
];

const CsvExportDialog: React.FC<Props> = ({ open, onClose, entries: preloadedEntries }) => {
  const { serverInfo, selectedDn, lastExportDir, setLastExportDir } = useAppStore();
  const [form] = Form.useForm<ExportForm>();

  const [fetching,      setFetching]      = useState(false);
  const [fetchedData,   setFetchedData]   = useState<LdapEntry[] | null>(
    preloadedEntries ?? null
  );
  const [selectedCols,  setSelectedCols]  = useState<string[]>([]);
  const [step,          setStep]          = useState<"config" | "columns">("config");

  const defaultBase = selectedDn ?? serverInfo?.activeBaseDn ?? "";

  // When data is available, compute available attributes and suggest defaults
  const availableAttrs = useMemo(() =>
    fetchedData ? collectAttrNames(fetchedData) : [],
  [fetchedData]);

  const handleFetch = async () => {
    const vals = await form.validateFields().catch(() => null);
    if (!vals) return;
    const maxEntries = vals.limitAll ? 0 : (vals.maxEntries ?? 1000);
    setFetching(true);
    try {
      const data = await api.exportEntries(
        vals.baseDn, vals.filter, vals.scope,
        vals.includeOperational, maxEntries,
      );
      setFetchedData(data);
      // Pre-select smart default columns
      const attrs = collectAttrNames(data);
      const priority = DEFAULT_PRIORITY_COLS.filter(c => attrs.includes(c));
      const rest     = attrs.filter(c => !DEFAULT_PRIORITY_COLS.includes(c)).slice(0, 10);
      setSelectedCols(priority.length > 0 ? priority : rest);
      setStep("columns");
    } catch (e) {
      message.error(`Error: ${e}`);
    } finally {
      setFetching(false);
    }
  };

  const handleDownload = async (format: "csv" | "xlsx") => {
    if (!fetchedData || selectedCols.length === 0) {
      message.warning("No columns selected");
      return;
    }
    const vals = form.getFieldsValue();
    const grid = buildGrid(fetchedData, selectedCols, vals.includeDn, vals.multiDelim || ";");
    const suggestedName = `export_${(vals.baseDn || "ldap").replace(/[^a-z0-9]/gi, "_")}`;

    if (format === "csv") {
      const filePath = await dialogSave({
        title: "Save CSV export",
        defaultPath: lastExportDir ? `${lastExportDir}/${suggestedName}.csv` : `${suggestedName}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!filePath) return;
      const csv = generateCsv(grid);
      await writeTextFile(filePath, "\ufeff" + csv); // BOM for Excel
      const dir = filePath.substring(0, Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")));
      await setLastExportDir(dir);
    } else {
      const filePath = await dialogSave({
        title: "Save Excel export",
        defaultPath: lastExportDir ? `${lastExportDir}/${suggestedName}.xlsx` : `${suggestedName}.xlsx`,
        filters: [{ name: "Excel", extensions: ["xlsx"] }],
      });
      if (!filePath) return;
      const ws = XLSX.utils.aoa_to_sheet(grid);
      const colWidths = selectedCols.map(c => ({ wch: Math.max(c.length, 12) }));
      if (vals.includeDn) colWidths.unshift({ wch: 60 });
      ws["!cols"] = colWidths;
      const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
        if (cell) cell.s = { font: { bold: true } };
      }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "LDAP Export");
      const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
      await writeFile(filePath, new Uint8Array(buf));
      const dir = filePath.substring(0, Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")));
      await setLastExportDir(dir);
    }

    message.success(`${fetchedData.length} entries exported`);
  };

  const handleClose = () => {
    setStep("config");
    setFetchedData(preloadedEntries ?? null);
    onClose();
  };

  return (
    <Modal
      open={open}
      title={<span><TableOutlined style={{ marginRight: 8 }} />CSV / Excel Export</span>}
      width={640}
      onCancel={handleClose}
      footer={
        step === "config" ? (
          <Space>
            <Button onClick={handleClose}>Cancel</Button>
            <Button type="primary" loading={fetching} onClick={handleFetch} icon={<DownloadOutlined />}>
              Fetch data ({fetchedData ? "refresh" : "load"})
            </Button>
          </Space>
        ) : (
          <Space>
            <Button onClick={() => setStep("config")}>← Change query</Button>
            <Button icon={<DownloadOutlined />} onClick={() => handleDownload("csv")}>
              Download CSV
            </Button>
            <Button type="primary" icon={<TableOutlined />} onClick={() => handleDownload("xlsx")}>
              Download Excel (.xlsx)
            </Button>
          </Space>
        )
      }
    >
      {step === "config" ? (
        <Form
          form={form}
          layout="vertical"
          size="small"
          initialValues={{
            baseDn: defaultBase,
            filter: "(objectClass=*)",
            scope: "sub",
            includeOperational: false,
            maxEntries: 1000,
            limitAll: false,
            includeDn: true,
            multiDelim: ";",
          }}
        >
          <Form.Item name="baseDn" label="Base DN" rules={[{ required: true }]}>
            <Input
              style={{ fontFamily: "monospace", fontSize: 12 }}
              addonAfter={<DnPickerButton onSelect={dn => form.setFieldValue("baseDn", dn)} />}
            />
          </Form.Item>

          <Space style={{ width: "100%" }} size={8}>
            <Form.Item name="filter" label="Filter" style={{ flex: 1 }}>
              <Input placeholder="(objectClass=*)" style={{ fontFamily: "monospace", fontSize: 12 }} />
            </Form.Item>
            <Form.Item name="scope" label="Scope" style={{ width: 140 }}>
              <Select options={[
                { value: "base", label: "Base"      },
                { value: "one",  label: "One-Level"  },
                { value: "sub",  label: "Subtree"    },
              ]} />
            </Form.Item>
          </Space>

          <Space align="start" size={24} wrap>
            <Form.Item label="Max entries">
              <Space>
                <Form.Item name="limitAll" valuePropName="checked" noStyle>
                  <Switch size="small" checkedChildren="All" unCheckedChildren="Limit" />
                </Form.Item>
                <Form.Item
                  noStyle
                  shouldUpdate={(p: ExportForm, c: ExportForm) => p.limitAll !== c.limitAll}
                >
                  {(f) => !f.getFieldValue("limitAll") && (
                    <Form.Item name="maxEntries" noStyle>
                      <InputNumber min={1} max={100000} step={100} style={{ width: 110 }} />
                    </Form.Item>
                  )}
                </Form.Item>
              </Space>
            </Form.Item>

            <Form.Item name="includeOperational" label="Operational attrs." valuePropName="checked">
              <Switch size="small" />
            </Form.Item>

            <Form.Item name="includeDn" label="Include DN column" valuePropName="checked">
              <Switch size="small" />
            </Form.Item>
          </Space>

          <Form.Item
            name="multiDelim"
            label="Multi-value separator"
            extra="Attributes with multiple values are joined with this character"
          >
            <Select style={{ width: 180 }} options={[
              { value: ";",  label: "; (semicolon)"       },
              { value: "|",  label: "| (pipe)"            },
              { value: ", ", label: ", (comma+space)"      },
              { value: "\n", label: "Newline (XLSX only)"  },
            ]} />
          </Form.Item>

          {fetchedData && (
            <Alert
              type="success" showIcon
              message={`${fetchedData.length} entries loaded — proceed to select columns`}
              action={<Button size="small" onClick={() => setStep("columns")}>Select columns →</Button>}
            />
          )}
        </Form>
      ) : (
        <div>
          {fetchedData && (
            <div style={{ marginBottom: 8 }}>
              <Tag color="blue">{fetchedData.length} entries</Tag>
              <Tag color="green">{availableAttrs.length} attributes found</Tag>
              <Tag color="orange">{selectedCols.length} columns selected</Tag>
            </div>
          )}

          <ColumnSelector
            available={availableAttrs}
            selected={selectedCols}
            onChange={setSelectedCols}
          />

          {/* Preview table */}
          {selectedCols.length > 0 && fetchedData && fetchedData.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>Preview (3 rows):</Text>
              <div style={{ marginTop: 4, overflow: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%" }}>
                  <thead>
                    <tr>
                      {form.getFieldValue("includeDn") && (
                        <th style={{ border: "1px solid #f0f0f0", padding: "2px 6px", background: "#fafafa", fontFamily: "monospace" }}>dn</th>
                      )}
                      {selectedCols.map(c => (
                        <th key={c} style={{ border: "1px solid #f0f0f0", padding: "2px 6px", background: "#fafafa", fontFamily: "monospace", whiteSpace: "nowrap" }}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fetchedData.slice(0, 3).map((entry, i) => (
                      <tr key={i}>
                        {form.getFieldValue("includeDn") && (
                          <td style={{ border: "1px solid #f0f0f0", padding: "2px 6px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace", fontSize: 10 }}>
                            {entry.dn}
                          </td>
                        )}
                        {selectedCols.map(c => (
                          <td key={c} style={{ border: "1px solid #f0f0f0", padding: "2px 6px", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {getAttrValue(entry, c, form.getFieldValue("multiDelim") || ";")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

export default CsvExportDialog;
