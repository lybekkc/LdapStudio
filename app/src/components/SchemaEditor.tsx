import React, { useEffect, useMemo, useState } from "react";
import {
  Modal, Tabs, Form, Input, Select, Switch, Button,
  Space, Typography, Alert, message,
} from "antd";
import {
  DeleteOutlined, ExclamationCircleOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../store/appStore";
import type { ObjectClass, AttributeType } from "../types";

const { Text } = Typography;
const { TextArea } = Input;

// ─── Schema definition string builders ───────────────────────────────────────

function buildOcDefinition(f: OcFormValues): string {
  const namePart = f.names.length > 1
    ? `NAME ( ${f.names.map(n => `'${n}'`).join(" $ ")} )`
    : `NAME '${f.names[0] ?? f.name}'`;
  const parts: string[] = [`( ${f.oid}`, namePart];
  if (f.description) parts.push(`DESC '${f.description}'`);
  if (f.superior.length) {
    parts.push(f.superior.length > 1
      ? `SUP ( ${f.superior.join(" $ ")} )`
      : `SUP ${f.superior[0]}`);
  }
  parts.push(f.kind);
  if (f.mustAttrs.length) {
    parts.push(f.mustAttrs.length > 1
      ? `MUST ( ${f.mustAttrs.join(" $ ")} )`
      : `MUST ${f.mustAttrs[0]}`);
  }
  if (f.mayAttrs.length) {
    parts.push(f.mayAttrs.length > 1
      ? `MAY ( ${f.mayAttrs.join(" $ ")} )`
      : `MAY ${f.mayAttrs[0]}`);
  }
  parts.push(")");
  return parts.join("\n  ");
}

function buildAtDefinition(f: AtFormValues): string {
  const namePart = f.names.length > 1
    ? `NAME ( ${f.names.map(n => `'${n}'`).join(" $ ")} )`
    : `NAME '${f.names[0] ?? f.name}'`;
  const parts: string[] = [`( ${f.oid}`, namePart];
  if (f.description) parts.push(`DESC '${f.description}'`);
  if (f.superior)    parts.push(`SUP ${f.superior}`);
  if (f.equality)    parts.push(`EQUALITY ${f.equality}`);
  if (f.ordering)    parts.push(`ORDERING ${f.ordering}`);
  if (f.substr)      parts.push(`SUBSTR ${f.substr}`);
  if (f.syntax)      parts.push(`SYNTAX ${f.syntax}`);
  if (f.singleValue) parts.push("SINGLE-VALUE");
  if (f.collective)  parts.push("COLLECTIVE");
  if (f.usage && f.usage !== "userApplications") parts.push(`USAGE ${f.usage}`);
  parts.push(")");
  return parts.join("\n  ");
}

// ─── Form value types ─────────────────────────────────────────────────────────

interface OcFormValues {
  oid: string;
  name: string;
  names: string[];
  description: string;
  superior: string[];
  kind: "STRUCTURAL" | "AUXILIARY" | "ABSTRACT";
  mustAttrs: string[];
  mayAttrs: string[];
}

interface AtFormValues {
  oid: string;
  name: string;
  names: string[];
  description: string;
  superior: string;
  equality: string;
  ordering: string;
  substr: string;
  syntax: string;
  singleValue: boolean;
  collective: boolean;
  usage: string;
}

// ─── ObjectClass Editor ───────────────────────────────────────────────────────

interface OcEditorProps {
  open: boolean;
  schemaDn: string;
  initial: ObjectClass | null;   // null = create new
  onClose: () => void;
  onSaved: () => void;
}

export const OcEditor: React.FC<OcEditorProps> = ({ open, schemaDn, initial, onClose, onSaved }) => {
  const { schema, modifySchemaEntry } = useAppStore();
  const [form] = Form.useForm<OcFormValues>();
  const [rawValue, setRawValue]   = useState("");
  const [activeTab, setActiveTab] = useState("form");
  const [saving, setSaving]       = useState(false);

  const isNew = initial === null;

  // Populate form when opening
  useEffect(() => {
    if (!open) return;
    setActiveTab("form");
    if (initial) {
      form.setFieldsValue({
        oid:         initial.oid,
        name:        initial.name,
        names:       initial.names.length ? initial.names : [initial.name],
        description: initial.description,
        superior:    initial.superior,
        kind:        initial.kind as OcFormValues["kind"],
        mustAttrs:   initial.mustAttrs,
        mayAttrs:    initial.mayAttrs,
      });
      setRawValue(initial.raw ?? "");
    } else {
      form.resetFields();
      form.setFieldsValue({ kind: "STRUCTURAL", mustAttrs: [], mayAttrs: [], superior: [], names: [] });
      setRawValue("");
    }
  }, [open, initial, form]);

  // Sync form → raw when form changes
  const syncFormToRaw = () => {
    try {
      const vals = form.getFieldsValue();
      if (vals.oid) setRawValue(buildOcDefinition(vals));
    } catch { /* ignore */ }
  };

  const handleSave = async () => {
    let definitionToSave = rawValue.trim();
    if (activeTab === "form") {
      try {
        const vals = await form.validateFields();
        definitionToSave = buildOcDefinition(vals);
      } catch { return; }
    }
    if (!definitionToSave) { message.error("Definisjon er tom"); return; }

    setSaving(true);
    try {
      await modifySchemaEntry(
        schemaDn,
        "objectClasses",
        initial?.raw ?? "",
        definitionToSave,
        `${isNew ? "Created" : "Modified"} ObjectClass${initial?.name ? ` "${initial.name}"` : ""}`,
      );
      message.success(isNew ? "ObjectClass opprettet" : "ObjectClass oppdatert");
      onSaved();
    } catch (e) {
      message.error(`Feil: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!initial?.raw) return;
    Modal.confirm({
      title: `Slett objectClass "${initial.name}"?`,
      icon: <ExclamationCircleOutlined style={{ color: "#d4380d" }} />,
      content: "Dette vil fjerne klassen fra schema-definisjonen. Allerede brukte entries påvirkes ikke.",
      okText: "Slett", okType: "danger", cancelText: "Avbryt",
      onOk: async () => {
        try {
          await modifySchemaEntry(
            schemaDn, "objectClasses", initial.raw!, "",
            `Deleted ObjectClass "${initial.name}"`,
          );
          message.success("ObjectClass slettet fra schema");
          onSaved();
        } catch (e) {
          message.error(`Feil: ${e}`);
        }
      },
    });
  };

  const allAttrNames = useMemo(() =>
    (schema?.attributeTypes ?? []).map(a => ({ value: a.name, label: a.name })),
  [schema]);

  const allOcNames = useMemo(() =>
    (schema?.objectClasses ?? [])
      .filter(o => !initial || o.name !== initial.name)
      .map(o => ({ value: o.name, label: o.name })),
  [schema, initial]);

  return (
    <Modal
      open={open}
      title={isNew ? "Ny ObjectClass" : `Rediger: ${initial?.name}`}
      width={680}
      onCancel={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div>
            {!isNew && (
              <Button danger onClick={handleDelete} icon={<DeleteOutlined />}>
                Slett fra schema
              </Button>
            )}
          </div>
          <Space>
            <Button onClick={onClose}>Avbryt</Button>
            <Button type="primary" loading={saving} onClick={handleSave}>
              {isNew ? "Opprett" : "Lagre"}
            </Button>
          </Space>
        </div>
      }
    >
      <Alert
        type="warning"
        showIcon
        message="Schema-endringer krever skriverettigheter til schema-entryen på LDAP-serveren."
        style={{ marginBottom: 12 }}
      />
      <Tabs
        activeKey={activeTab}
        onChange={key => { setActiveTab(key); if (key === "raw") syncFormToRaw(); }}
        items={[
          {
            key: "form",
            label: "Skjema",
            children: (
              <Form form={form} layout="vertical" size="small">
                <Space.Compact style={{ width: "100%" }}>
                  <Form.Item name="oid" label="OID" rules={[{ required: true }]} style={{ flex: 1 }}>
                    <Input placeholder="1.3.6.1.4.1.XXXXX.1" style={{ fontFamily: "monospace" }} />
                  </Form.Item>
                  <Form.Item name="kind" label="Type" rules={[{ required: true }]} style={{ width: 140 }}>
                    <Select options={[
                      { value: "STRUCTURAL", label: "STRUCTURAL" },
                      { value: "AUXILIARY",  label: "AUXILIARY"  },
                      { value: "ABSTRACT",   label: "ABSTRACT"   },
                    ]} />
                  </Form.Item>
                </Space.Compact>

                <Form.Item name="name" label="Navn (primær)" rules={[{ required: true }]}>
                  <Input placeholder="myObjectClass" />
                </Form.Item>

                <Form.Item name="names" label="Alle navn (alias)">
                  <Select mode="tags" placeholder="Skriv og trykk Enter for hvert navn" />
                </Form.Item>

                <Form.Item name="description" label="Beskrivelse">
                  <Input placeholder="Valgfri beskrivelse" />
                </Form.Item>

                <Form.Item name="superior" label="SUP (overklasse)">
                  <Select mode="multiple" options={allOcNames} placeholder="Velg eller skriv OC-navn" showSearch />
                </Form.Item>

                <Form.Item name="mustAttrs" label="MUST (påkrevde attributter)">
                  <Select mode="multiple" options={allAttrNames}
                    placeholder="Velg attributter" showSearch />
                </Form.Item>

                <Form.Item name="mayAttrs" label="MAY (valgfrie attributter)">
                  <Select mode="multiple" options={allAttrNames}
                    placeholder="Velg attributter" showSearch />
                </Form.Item>
              </Form>
            ),
          },
          {
            key: "raw",
            label: "Rå definisjon",
            children: (
              <div>
                <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
                  RFC 4512 objectClassDescription-format. Generert automatisk fra skjema, eller rediger direkte.
                </Text>
                <TextArea
                  value={rawValue}
                  onChange={e => setRawValue(e.target.value)}
                  rows={10}
                  style={{ fontFamily: "monospace", fontSize: 12 }}
                  placeholder="( OID NAME 'name' SUP top STRUCTURAL MAY ( attr1 $ attr2 ) )"
                />
              </div>
            ),
          },
        ]}
      />
    </Modal>
  );
};

// ─── AttributeType Editor ─────────────────────────────────────────────────────

interface AtEditorProps {
  open: boolean;
  schemaDn: string;
  initial: AttributeType | null;
  onClose: () => void;
  onSaved: () => void;
}

// Common LDAP syntax OIDs with descriptions
const COMMON_SYNTAXES = [
  { value: "1.3.6.1.4.1.1466.115.121.1.15", label: "Directory String" },
  { value: "1.3.6.1.4.1.1466.115.121.1.26", label: "IA5 String" },
  { value: "1.3.6.1.4.1.1466.115.121.1.27", label: "Integer" },
  { value: "1.3.6.1.4.1.1466.115.121.1.12", label: "DN" },
  { value: "1.3.6.1.4.1.1466.115.121.1.5",  label: "Binary" },
  { value: "1.3.6.1.4.1.1466.115.121.1.22", label: "Facsimile Telephone" },
  { value: "1.3.6.1.4.1.1466.115.121.1.28", label: "JPEG" },
  { value: "1.3.6.1.4.1.1466.115.121.1.40", label: "Octet String" },
  { value: "1.3.6.1.4.1.1466.115.121.1.50", label: "Telephone Number" },
];

export const AtEditor: React.FC<AtEditorProps> = ({ open, schemaDn, initial, onClose, onSaved }) => {
  const { schema, modifySchemaEntry } = useAppStore();
  const [form] = Form.useForm<AtFormValues>();
  const [rawValue, setRawValue]   = useState("");
  const [activeTab, setActiveTab] = useState("form");
  const [saving, setSaving]       = useState(false);

  const isNew = initial === null;

  useEffect(() => {
    if (!open) return;
    setActiveTab("form");
    if (initial) {
      form.setFieldsValue({
        oid:         initial.oid,
        name:        initial.name,
        names:       initial.names.length ? initial.names : [initial.name],
        description: initial.description,
        superior:    initial.superior ?? "",
        equality:    initial.equality ?? "",
        ordering:    initial.ordering ?? "",
        substr:      initial.substr   ?? "",
        syntax:      initial.syntax   ?? "",
        singleValue: initial.singleValue,
        collective:  initial.collective,
        usage:       initial.usage,
      });
      setRawValue(initial.raw ?? "");
    } else {
      form.resetFields();
      form.setFieldsValue({ singleValue: false, collective: false, usage: "userApplications", names: [] });
      setRawValue("");
    }
  }, [open, initial, form]);

  const syncFormToRaw = () => {
    try {
      const vals = form.getFieldsValue();
      if (vals.oid) setRawValue(buildAtDefinition(vals));
    } catch { /* ignore */ }
  };

  const handleSave = async () => {
    let definitionToSave = rawValue.trim();
    if (activeTab === "form") {
      try {
        const vals = await form.validateFields();
        definitionToSave = buildAtDefinition(vals);
      } catch { return; }
    }
    if (!definitionToSave) { message.error("Definisjon er tom"); return; }
    setSaving(true);
    try {
      await modifySchemaEntry(
        schemaDn, "attributeTypes", initial?.raw ?? "", definitionToSave,
        `${isNew ? "Created" : "Modified"} AttributeType${initial?.name ? ` "${initial.name}"` : ""}`,
      );
      message.success(isNew ? "AttributeType opprettet" : "AttributeType oppdatert");
      onSaved();
    } catch (e) {
      message.error(`Feil: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!initial?.raw) return;
    Modal.confirm({
      title: `Slett attributt "${initial.name}"?`,
      icon: <ExclamationCircleOutlined style={{ color: "#d4380d" }} />,
      content: "Dette vil fjerne attributtdefinisjonen fra schema.",
      okText: "Slett", okType: "danger", cancelText: "Avbryt",
      onOk: async () => {
        try {
          await modifySchemaEntry(
            schemaDn, "attributeTypes", initial.raw!, "",
            `Deleted AttributeType "${initial.name}"`,
          );
          message.success("AttributeType slettet");
          onSaved();
        } catch (e) {
          message.error(`Feil: ${e}`);
        }
      },
    });
  };

  const allAttrNames = useMemo(() =>
    (schema?.attributeTypes ?? [])
      .filter(a => !initial || a.name !== initial.name)
      .map(a => ({ value: a.name, label: a.name })),
  [schema, initial]);

  const syntaxOptions = useMemo(() => {
    const custom = (schema?.ldapSyntaxes ?? []).map(s => ({
      value: s.oid,
      label: `${s.oid} (${s.description})`,
    }));
    // merge with common syntaxes (deduplicate)
    const oidSet = new Set(custom.map(c => c.value));
    const extras = COMMON_SYNTAXES.filter(s => !oidSet.has(s.value)).map(s => ({
      value: s.value,
      label: `${s.value} — ${s.label}`,
    }));
    return [...extras, ...custom];
  }, [schema]);

  const matchingRuleOptions = useMemo(() =>
    (schema?.matchingRules ?? []).map(r => ({ value: r.name || r.oid, label: r.name || r.oid })),
  [schema]);

  return (
    <Modal
      open={open}
      title={isNew ? "Ny AttributeType" : `Rediger: ${initial?.name}`}
      width={700}
      onCancel={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div>
            {!isNew && (
              <Button danger onClick={handleDelete} icon={<DeleteOutlined />}>
                Slett fra schema
              </Button>
            )}
          </div>
          <Space>
            <Button onClick={onClose}>Avbryt</Button>
            <Button type="primary" loading={saving} onClick={handleSave}>
              {isNew ? "Opprett" : "Lagre"}
            </Button>
          </Space>
        </div>
      }
    >
      <Alert
        type="warning" showIcon
        message="Schema-endringer krever skriverettigheter til schema-entryen."
        style={{ marginBottom: 12 }}
      />
      <Tabs
        activeKey={activeTab}
        onChange={key => { setActiveTab(key); if (key === "raw") syncFormToRaw(); }}
        items={[
          {
            key: "form",
            label: "Skjema",
            children: (
              <Form form={form} layout="vertical" size="small">
                <Space.Compact style={{ width: "100%" }}>
                  <Form.Item name="oid" label="OID" rules={[{ required: true }]} style={{ flex: 2 }}>
                    <Input placeholder="1.3.6.1.4.1.XXXXX.2" style={{ fontFamily: "monospace" }} />
                  </Form.Item>
                  <Form.Item name="name" label="Navn" rules={[{ required: true }]} style={{ flex: 1 }}>
                    <Input placeholder="myAttr" />
                  </Form.Item>
                </Space.Compact>

                <Form.Item name="names" label="Alle navn (alias)">
                  <Select mode="tags" placeholder="Skriv og trykk Enter" />
                </Form.Item>

                <Form.Item name="description" label="Beskrivelse">
                  <Input />
                </Form.Item>

                <Form.Item name="superior" label="SUP (overordnet attributt)">
                  <Select showSearch allowClear options={allAttrNames} placeholder="Arv fra…" />
                </Form.Item>

                <Form.Item name="syntax" label="Syntax (OID)">
                  <Select showSearch allowClear options={syntaxOptions} placeholder="Velg syntax…" />
                </Form.Item>

                <Space style={{ width: "100%" }}>
                  <Form.Item name="equality" label="EQUALITY" style={{ flex: 1 }}>
                    <Select showSearch allowClear options={matchingRuleOptions} placeholder="Matching rule" />
                  </Form.Item>
                  <Form.Item name="ordering" label="ORDERING" style={{ flex: 1 }}>
                    <Select showSearch allowClear options={matchingRuleOptions} placeholder="Matching rule" />
                  </Form.Item>
                  <Form.Item name="substr" label="SUBSTR" style={{ flex: 1 }}>
                    <Select showSearch allowClear options={matchingRuleOptions} placeholder="Matching rule" />
                  </Form.Item>
                </Space>

                <Space>
                  <Form.Item name="singleValue" label="Single-Value" valuePropName="checked">
                    <Switch size="small" />
                  </Form.Item>
                  <Form.Item name="collective" label="Collective" valuePropName="checked">
                    <Switch size="small" />
                  </Form.Item>
                </Space>

                <Form.Item name="usage" label="Usage">
                  <Select options={[
                    { value: "userApplications",    label: "userApplications (default)" },
                    { value: "directoryOperation",  label: "directoryOperation" },
                    { value: "distributedOperation",label: "distributedOperation" },
                    { value: "dSAOperation",         label: "dSAOperation" },
                  ]} />
                </Form.Item>
              </Form>
            ),
          },
          {
            key: "raw",
            label: "Rå definisjon",
            children: (
              <div>
                <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
                  RFC 4512 attributeTypeDescription-format.
                </Text>
                <TextArea
                  value={rawValue}
                  onChange={e => setRawValue(e.target.value)}
                  rows={10}
                  style={{ fontFamily: "monospace", fontSize: 12 }}
                  placeholder="( OID NAME 'name' SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )"
                />
              </div>
            ),
          },
        ]}
      />
    </Modal>
  );
};



