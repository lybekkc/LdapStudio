import React, { useState } from "react";
import {
  Modal, Form, Input, Select, Switch, Button, Space, Typography,
  Tabs, InputNumber, Alert, Tag, Divider, Upload, message,
} from "antd";
import {
  DownloadOutlined, UploadOutlined, InboxOutlined,
  CheckCircleOutlined, CloseCircleOutlined,
} from "@ant-design/icons";
import { save as dialogSave, open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { useAppStore } from "../store/appStore";
import * as api from "../api/commands";
import type { LdifImportResult } from "../types";
import DnPickerButton from "./DnPickerButton";

const { Text, Paragraph } = Typography;
const { TextArea } = Input;
const { Dragger } = Upload;


// ─── Export Dialog ────────────────────────────────────────────────────────────

interface ExportProps {
  open: boolean;
  onClose: () => void;
  initialBaseDn?: string;
}

interface ExportForm {
  baseDn:             string;
  filter:             string;
  scope:              string;
  includeOperational: boolean;
  maxEntries:         number;  // 0 = all
  limitAll:           boolean; // toggle for "all"
}

export const LdifExportDialog: React.FC<ExportProps> = ({ open, onClose, initialBaseDn }) => {
  const { serverInfo, selectedDn, lastExportDir, setLastExportDir } = useAppStore();
  const [form] = Form.useForm<ExportForm>();
  const [exporting, setExporting] = useState(false);
  const [preview, setPreview]     = useState<string | null>(null);
  const [exportedCount, setExportedCount] = useState<number | null>(null);

  const defaultBase = initialBaseDn ?? selectedDn ?? serverInfo?.activeBaseDn ?? "";

  const handleExport = async (download: boolean) => {
    const vals = await form.validateFields().catch(() => null);
    if (!vals) return;

    const maxEntries = vals.limitAll ? 0 : (vals.maxEntries ?? 1000);
    setExporting(true);
    setPreview(null);
    try {
      const ldif = await api.exportLdif(
        vals.baseDn, vals.filter, vals.scope,
        vals.includeOperational, maxEntries,
      );
      const lines = ldif.split("\n");
      const count = lines.filter(l => l.toLowerCase().startsWith("dn:")).length;
      setExportedCount(count);

      if (download) {
        const suggestedName = `export_${vals.baseDn.replace(/[^a-z0-9]/gi, "_")}.ldif`;
        const filePath = await dialogSave({
          title: "Save LDIF export",
          defaultPath: lastExportDir ? `${lastExportDir}/${suggestedName}` : suggestedName,
          filters: [{ name: "LDIF", extensions: ["ldif", "ldf", "txt"] }],
        });
        if (!filePath) return; // user cancelled
        await writeTextFile(filePath, ldif);
        // Persist directory for next time
        const dir = filePath.substring(0, Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")));
        await setLastExportDir(dir);
        message.success(`${count} entries exported`);
      } else {
        setPreview(lines.slice(0, 80).join("\n") + (lines.length > 80 ? "\n..." : ""));
      }
    } catch (e) {
      message.error(`Export failed: ${e}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={<span><DownloadOutlined style={{ marginRight: 8 }} />LDIF Export</span>}
      width={600}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>Close</Button>
          <Button icon={<DownloadOutlined />} onClick={() => handleExport(false)} loading={exporting}>
            Preview
          </Button>
          <Button type="primary" icon={<DownloadOutlined />} onClick={() => handleExport(true)} loading={exporting}>
            Download .ldif
          </Button>
        </Space>
      }
    >
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
              { value: "base", label: "Base"     },
              { value: "one",  label: "One-Level" },
              { value: "sub",  label: "Subtree"   },
            ]} />
          </Form.Item>
        </Space>

        <Space align="start" size={24}>
          <Form.Item label="Max entries">
            <Space>
              <Form.Item name="limitAll" valuePropName="checked" noStyle>
                <Switch size="small" checkedChildren="All" unCheckedChildren="Limit" />
              </Form.Item>
              <Form.Item
                noStyle
                shouldUpdate={(prev: ExportForm, cur: ExportForm) => prev.limitAll !== cur.limitAll}
              >
                {(formInst) =>
                  !formInst.getFieldValue("limitAll") && (
                    <Form.Item name="maxEntries" noStyle>
                      <InputNumber min={1} max={100000} step={100} style={{ width: 110 }} />
                    </Form.Item>
                  )
                }
              </Form.Item>
            </Space>
          </Form.Item>

          <Form.Item name="includeOperational" label="Operational attributes" valuePropName="checked">
            <Switch size="small" />
          </Form.Item>
        </Space>

        {exportedCount !== null && (
          <Alert
            type="success"
            showIcon
            message={`${exportedCount} entries ready for export`}
            style={{ marginBottom: 8 }}
          />
        )}

        {preview && (
          <div>
            <Text type="secondary" style={{ fontSize: 11 }}>Preview (first 80 lines):</Text>
            <TextArea
              value={preview}
              readOnly
              rows={10}
              style={{ fontFamily: "monospace", fontSize: 11, marginTop: 4 }}
            />
          </div>
        )}
      </Form>
    </Modal>
  );
};

// ─── Import Dialog ────────────────────────────────────────────────────────────

interface ImportProps {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
}

export const LdifImportDialog: React.FC<ImportProps> = ({ open, onClose, onImported }) => {
  const { lastImportDir, setLastImportDir } = useAppStore();
  const [ldifContent,       setLdifContent]       = useState("");
  const [dryRun,            setDryRun]            = useState(true);
  const [continueOnError,   setContinueOnError]   = useState(true);
  const [importing,         setImporting]         = useState(false);
  const [result,            setResult]            = useState<LdifImportResult | null>(null);
  const [fileName,          setFileName]          = useState<string | null>(null);
  // Full path known only when file was opened via the dialog (not drag-drop)
  const [filePath,          setFilePath]          = useState<string | null>(null);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      setLdifContent(e.target?.result as string ?? "");
      setFileName(file.name);
      setFilePath(null);   // drag-drop has no full path
      setResult(null);
    };
    reader.readAsText(file, "utf-8");
    return false;
  };

  const handleBrowseFile = async () => {
    const fp = await dialogOpen({
      title: "Open LDIF file",
      defaultPath: lastImportDir || undefined,
      multiple: false,
      filters: [{ name: "LDIF", extensions: ["ldif", "ldf", "txt"] }],
    });
    if (!fp || Array.isArray(fp)) return;
    const content = await readTextFile(fp);
    const name = fp.split(/[/\\]/).pop() ?? fp;
    setLdifContent(content);
    setFileName(name);
    setFilePath(fp);
    setResult(null);
    const dir = fp.substring(0, Math.max(fp.lastIndexOf("/"), fp.lastIndexOf("\\")));
    await setLastImportDir(dir);
  };

  /** Build an Apache-DS-compatible .log string from the import result. */
  const buildLogContent = (r: LdifImportResult, isDryRun: boolean): string => {
    const now = new Date().toISOString();
    const lines: string[] = [
      "#!ldapstudio-ldif-result#",
      "#!VERSION=1.0",
      `#!DATE=${now}`,
      `#!DRY-RUN=${isDryRun}`,
      `#!ADDED=${r.added} MODIFIED=${r.modified} DELETED=${r.deleted} FAILED=${r.failed}`,
      "",
    ];
    for (const entry of r.entries) {
      lines.push(`dn: ${entry.dn}`);
      lines.push(`changetype: ${entry.changetype}`);
      if (entry.success) {
        lines.push("# OK");
      } else {
        lines.push(`# ERROR: ${entry.error ?? "unknown error"}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  };

  const handleImport = async () => {
    if (!ldifContent.trim()) { message.warning("No LDIF content"); return; }
    setImporting(true);
    setResult(null);
    try {
      const r = await api.importLdif(ldifContent, dryRun, continueOnError);
      setResult(r);

      // ── Write .log file next to the source file ──────────────────────────
      if (filePath) {
        const logPath = filePath.replace(/\.[^./\\]+$/, "") + ".log";
        try {
          await writeTextFile(logPath, buildLogContent(r, dryRun));
        } catch (logErr) {
          console.warn("Could not write import log:", logErr);
        }
      }

      if (!dryRun && r.failed === 0) {
        message.success(`Import completed: +${r.added} ~${r.modified} -${r.deleted}`);
      } else if (!dryRun && (r.added > 0 || r.modified > 0 || r.deleted > 0)) {
        message.warning(`Partially completed: +${r.added} ~${r.modified} -${r.deleted}, ${r.failed} failed`);
      }
      // Always refresh the tree after a real import attempt so newly
      // added (or already-existing) entries become visible.
      if (!dryRun) onImported?.();
    } catch (e) {
      message.error(`Import failed: ${e}`);
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    setLdifContent("");
    setFileName(null);
    setFilePath(null);
    setResult(null);
    onClose();
  };

  // Count operations in the pasted/loaded LDIF
  const opCounts = React.useMemo(() => {
    if (!ldifContent) return { total: 0 };
    const dns = ldifContent.match(/^dn:/gim)?.length ?? 0;
    const dels = ldifContent.match(/^changetype:\s*delete/gim)?.length ?? 0;
    const mods = ldifContent.match(/^changetype:\s*modify/gim)?.length ?? 0;
    return { total: dns, deletes: dels, modifies: mods, adds: dns - dels - mods };
  }, [ldifContent]);

  return (
    <Modal
      open={open}
      title={<span><UploadOutlined style={{ marginRight: 8 }} />LDIF Import</span>}
      width={620}
      onCancel={handleClose}
      footer={
        <Space>
          <Button onClick={handleClose}>Close</Button>
          <Button
            type={dryRun ? "default" : "primary"}
            loading={importing}
            onClick={handleImport}
            icon={dryRun ? <CheckCircleOutlined /> : <UploadOutlined />}
          >
            {dryRun ? "Dry run (validate)" : "Import now"}
          </Button>
        </Space>
      }
    >
      <Tabs
        items={[
          {
            key: "file",
            label: "File",
            children: (
              <div>
                <Button
                  icon={<UploadOutlined />}
                  style={{ marginBottom: 8 }}
                  onClick={handleBrowseFile}
                >
                  Browse for LDIF file…
                </Button>
                {fileName && <Tag color="blue" style={{ marginLeft: 8 }}>{fileName}</Tag>}
                <Dragger
                  accept=".ldif,.ldf,text/plain"
                  showUploadList={false}
                  beforeUpload={handleFile}
                  style={{ marginTop: 4 }}
                >
                  <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                  <p>Or drag & drop a .ldif file here</p>
                </Dragger>
              </div>
            ),
          },
          {
            key: "paste",
            label: "Paste LDIF",
            children: (
              <TextArea
                value={ldifContent}
                onChange={e => { setLdifContent(e.target.value); setResult(null); }}
                rows={10}
                placeholder={"version: 1\n\ndn: uid=john,ou=people,dc=example,dc=com\nchangetype: add\nobjectClass: inetOrgPerson\ncn: John Doe\nsn: Doe"}
                style={{ fontFamily: "monospace", fontSize: 11 }}
              />
            ),
          },
        ]}
      />

      {/* Content summary */}
      {opCounts.total > 0 && (
        <div style={{ margin: "8px 0", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Tag color="blue">{opCounts.total} entries</Tag>
          {(opCounts.adds ?? 0) > 0    && <Tag color="green">+{opCounts.adds} add</Tag>}
          {(opCounts.modifies ?? 0) > 0 && <Tag color="orange">~{opCounts.modifies} modify</Tag>}
          {(opCounts.deletes ?? 0) > 0  && <Tag color="red">-{opCounts.deletes} delete</Tag>}
        </div>
      )}

      <Divider style={{ margin: "8px 0" }} />

      {/* Import options */}
      <Space size={24} wrap>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Switch size="small" checked={dryRun} onChange={setDryRun} />
          <span style={{ fontSize: 12 }}>
            <Text strong>Dry run</Text>
            <Text type="secondary" style={{ marginLeft: 4, fontSize: 11 }}>
              (validate without writing)
            </Text>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Switch size="small" checked={continueOnError} onChange={setContinueOnError} />
          <Text style={{ fontSize: 12 }}>Continue on error</Text>
        </div>
      </Space>

      {dryRun && (
        <Alert
          type="info" showIcon
          message="Dry run active — no changes will be saved"
          style={{ marginTop: 8 }}
        />
      )}

      {/* Result */}
      {result && (
        <div style={{ marginTop: 12 }}>
          <Divider orientation="left" style={{ fontSize: 12, margin: "8px 0" }}>Result</Divider>
          <Space wrap>
            <Tag color="green" icon={<CheckCircleOutlined />}>+{result.added} added</Tag>
            <Tag color="orange">~{result.modified} modified</Tag>
            <Tag color="red">-{result.deleted} deleted</Tag>
            {result.skipped > 0   && <Tag color="default">{result.skipped} skipped</Tag>}
            {result.failed > 0    && <Tag color="red" icon={<CloseCircleOutlined />}>{result.failed} failed</Tag>}
          </Space>

          {filePath && (
            <div style={{ marginTop: 6 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                📄 Log written to:{" "}
                <code style={{ fontSize: 11 }}>
                  {filePath.replace(/\.[^./\\]+$/, "") + ".log"}
                </code>
              </Text>
            </div>
          )}

          {result.errors.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <Text type="danger" style={{ fontSize: 11, fontWeight: 600 }}>Errors:</Text>
              <div style={{
                marginTop: 4, padding: "6px 8px",
                background: "#fff2f0", border: "1px solid #ffccc7", borderRadius: 4,
                maxHeight: 120, overflow: "auto",
              }}>
                {result.errors.map((e, i) => (
                  <Paragraph key={i} style={{ fontSize: 11, margin: 0, color: "#cf1322" }}>
                    {e}
                  </Paragraph>
                ))}
              </div>
            </div>
          )}

          {dryRun && result.failed === 0 && (
            <Alert
              type="success" showIcon
              message="Dry run OK — click 'Import now' to execute"
              style={{ marginTop: 8 }}
              action={
                <Button size="small" type="primary"
                  onClick={() => { setDryRun(false); }}>
                  Import now
                </Button>
              }
            />
          )}
        </div>
      )}
    </Modal>
  );
};
