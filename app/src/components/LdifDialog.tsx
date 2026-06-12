import React, { useState } from "react";
import {
  Modal, Form, Input, Select, Switch, Button, Space, Typography,
  Tabs, InputNumber, Alert, Tag, Divider, Upload, message,
} from "antd";
import {
  DownloadOutlined, UploadOutlined, InboxOutlined,
  CheckCircleOutlined, CloseCircleOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../store/appStore";
import * as api from "../api/commands";
import type { LdifImportResult } from "../types";

const { Text, Paragraph } = Typography;
const { TextArea } = Input;
const { Dragger } = Upload;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Trigger a browser-side text file download */
function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

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
  const { serverInfo, selectedDn } = useAppStore();
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
        const filename = `export_${vals.baseDn.replace(/[^a-z0-9]/gi, "_")}.ldif`;
        downloadText(filename, ldif);
        message.success(`${count} entries eksportert`);
      } else {
        // Preview mode — show first 50 lines
        setPreview(lines.slice(0, 80).join("\n") + (lines.length > 80 ? "\n..." : ""));
      }
    } catch (e) {
      message.error(`Eksport feilet: ${e}`);
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
          <Button onClick={onClose}>Lukk</Button>
          <Button icon={<DownloadOutlined />} onClick={() => handleExport(false)} loading={exporting}>
            Forhåndsvis
          </Button>
          <Button type="primary" icon={<DownloadOutlined />} onClick={() => handleExport(true)} loading={exporting}>
            Last ned .ldif
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
          <Input style={{ fontFamily: "monospace", fontSize: 12 }} />
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
          <Form.Item label="Maks antall entries">
            <Space>
              <Form.Item name="limitAll" valuePropName="checked" noStyle>
                <Switch size="small" checkedChildren="Alle" unCheckedChildren="Antall" />
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

          <Form.Item name="includeOperational" label="Operasjonelle attributter" valuePropName="checked">
            <Switch size="small" />
          </Form.Item>
        </Space>

        {exportedCount !== null && (
          <Alert
            type="success"
            showIcon
            message={`${exportedCount} entries klar for eksport`}
            style={{ marginBottom: 8 }}
          />
        )}

        {preview && (
          <div>
            <Text type="secondary" style={{ fontSize: 11 }}>Forhåndsvisning (første 80 linjer):</Text>
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
  const [ldifContent,       setLdifContent]       = useState("");
  const [dryRun,            setDryRun]            = useState(true);
  const [continueOnError,   setContinueOnError]   = useState(true);
  const [importing,         setImporting]         = useState(false);
  const [result,            setResult]            = useState<LdifImportResult | null>(null);
  const [fileName,          setFileName]          = useState<string | null>(null);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      setLdifContent(e.target?.result as string ?? "");
      setFileName(file.name);
      setResult(null);
    };
    reader.readAsText(file, "utf-8");
    return false; // prevent default upload
  };

  const handleImport = async () => {
    if (!ldifContent.trim()) { message.warning("Ingen LDIF-innhold"); return; }
    setImporting(true);
    setResult(null);
    try {
      const r = await api.importLdif(ldifContent, dryRun, continueOnError);
      setResult(r);
      if (!dryRun && r.failed === 0) {
        message.success(`Import fullført: +${r.added} ~${r.modified} -${r.deleted}`);
        onImported?.();
      }
    } catch (e) {
      message.error(`Import feilet: ${e}`);
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    setLdifContent("");
    setFileName(null);
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
          <Button onClick={handleClose}>Lukk</Button>
          <Button
            type={dryRun ? "default" : "primary"}
            loading={importing}
            onClick={handleImport}
            icon={dryRun ? <CheckCircleOutlined /> : <UploadOutlined />}
          >
            {dryRun ? "Dry run (valider)" : "Importer nå"}
          </Button>
        </Space>
      }
    >
      <Tabs
        items={[
          {
            key: "file",
            label: "Fil",
            children: (
              <Dragger
                accept=".ldif,.ldf,text/plain"
                showUploadList={false}
                beforeUpload={handleFile}
                style={{ marginBottom: 8 }}
              >
                <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                <p>Dra og slipp en .ldif-fil hit, eller klikk for å velge</p>
                {fileName && <Tag color="blue">{fileName}</Tag>}
              </Dragger>
            ),
          },
          {
            key: "paste",
            label: "Lim inn LDIF",
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
              (valider uten å skrive)
            </Text>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Switch size="small" checked={continueOnError} onChange={setContinueOnError} />
          <Text style={{ fontSize: 12 }}>Fortsett ved feil</Text>
        </div>
      </Space>

      {dryRun && (
        <Alert
          type="info" showIcon
          message="Dry run aktivert — ingen endringer vil bli lagret"
          style={{ marginTop: 8 }}
        />
      )}

      {/* Result */}
      {result && (
        <div style={{ marginTop: 12 }}>
          <Divider orientation="left" style={{ fontSize: 12, margin: "8px 0" }}>Resultat</Divider>
          <Space wrap>
            <Tag color="green" icon={<CheckCircleOutlined />}>+{result.added} lagt til</Tag>
            <Tag color="orange">~{result.modified} endret</Tag>
            <Tag color="red">-{result.deleted} slettet</Tag>
            {result.skipped > 0   && <Tag color="default">{result.skipped} hoppet over</Tag>}
            {result.failed > 0    && <Tag color="red" icon={<CloseCircleOutlined />}>{result.failed} feilet</Tag>}
          </Space>

          {result.errors.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <Text type="danger" style={{ fontSize: 11, fontWeight: 600 }}>Feil:</Text>
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
              message="Dry run OK — klikk 'Importer nå' for å utføre"
              style={{ marginTop: 8 }}
              action={
                <Button size="small" type="primary"
                  onClick={() => { setDryRun(false); }}>
                  Importer nå
                </Button>
              }
            />
          )}
        </div>
      )}
    </Modal>
  );
};

