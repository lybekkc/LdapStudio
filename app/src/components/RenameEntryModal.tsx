import React, { useState, useEffect } from "react";
import {
  Modal, Form, Input, Switch, Space, Typography, Alert, Divider,
} from "antd";
import { SwapOutlined } from "@ant-design/icons";
import { useAppStore } from "../store/appStore";
import { message } from "antd";
import DnPickerButton from "./DnPickerButton";

const { Text } = Typography;

interface Props {
  open: boolean;
  dn: string;
  onClose: () => void;
  onRenamed: (newDn: string) => void;
}

interface FormValues {
  rdnAttr: string;
  rdnValue: string;
  newSuperior: string;
  deleteOldRdn: boolean;
}

/** Parse the first RDN from a full DN */
function parseRdn(dn: string): { attr: string; value: string } {
  const first = dn.split(",")[0] ?? dn;
  const eq = first.indexOf("=");
  if (eq < 0) return { attr: "", value: first };
  return { attr: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim() };
}

/** Get the parent DN (everything after the first RDN) */
function parentDn(dn: string): string {
  const idx = dn.indexOf(",");
  return idx < 0 ? "" : dn.slice(idx + 1);
}

const RenameEntryModal: React.FC<Props> = ({ open, dn, onClose, onRenamed }) => {
  const { renameEntry } = useAppStore();
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);

  const original = parseRdn(dn);
  const originalParent = parentDn(dn);

  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        rdnAttr:      original.attr,
        rdnValue:     original.value,
        newSuperior:  originalParent,
        deleteOldRdn: true,
      });
    }
  }, [open, dn]);

  const getPreviewDn = (): string => {
    const vals = form.getFieldsValue();
    const rdn = `${vals.rdnAttr}=${vals.rdnValue}`;
    const parent = vals.newSuperior?.trim() || originalParent;
    return parent ? `${rdn},${parent}` : rdn;
  };

  const handleOk = async () => {
    const vals = await form.validateFields().catch(() => null);
    if (!vals) return;

    const newRdn = `${vals.rdnAttr}=${vals.rdnValue}`;
    const oldRdn = `${original.attr}=${original.value}`;
    const newSuperior = vals.newSuperior?.trim() !== originalParent
      ? vals.newSuperior?.trim() || undefined
      : undefined;

    if (newRdn === oldRdn && !newSuperior) {
      message.info("No changes made");
      return;
    }

    setSaving(true);
    try {
      const newDn = await renameEntry(dn, newRdn, vals.deleteOldRdn, newSuperior);
      message.success(`Entry renamed/moved successfully`);
      onRenamed(newDn);
      onClose();
    } catch (e) {
      message.error(`Rename failed: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={<span><SwapOutlined style={{ marginRight: 8 }} />Rename / Move Entry</span>}
      width={560}
      onCancel={onClose}
      onOk={handleOk}
      okText="Rename / Move"
      confirmLoading={saving}
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16, fontSize: 12 }}
        message="This operation is immediate and cannot easily be undone if the entry has group memberships — member/memberOf attributes pointing to the old DN will not be updated automatically."
      />

      <div style={{ marginBottom: 12 }}>
        <Text type="secondary" style={{ fontSize: 11 }}>Current DN:</Text>
        <br />
        <Text code style={{ fontSize: 11, wordBreak: "break-all" }}>{dn}</Text>
      </div>

      <Form form={form} layout="vertical" size="small">

        <Divider orientation="left" style={{ fontSize: 12, margin: "8px 0" }}>RDN (Relative Distinguished Name)</Divider>

        <Space.Compact style={{ width: "100%" }}>
          <Form.Item
            name="rdnAttr"
            label="Attribute"
            style={{ width: 140, marginBottom: 0 }}
            rules={[{ required: true }]}
          >
            <Input style={{ fontFamily: "monospace", fontSize: 12 }} placeholder="uid" />
          </Form.Item>
          <Form.Item
            name="rdnValue"
            label="Value"
            style={{ flex: 1, marginBottom: 0 }}
            rules={[{ required: true, message: "RDN value is required" }]}
          >
            <Input style={{ fontFamily: "monospace", fontSize: 12 }} />
          </Form.Item>
        </Space.Compact>

        <Form.Item
          name="deleteOldRdn"
          label="Delete old RDN attribute value"
          valuePropName="checked"
          style={{ marginTop: 12 }}
          extra="Removes the old RDN value (e.g. uid=john) from the entry after rename. Usually desired."
        >
          <Switch size="small" />
        </Form.Item>

        <Divider orientation="left" style={{ fontSize: 12, margin: "8px 0" }}>Parent DN (move)</Divider>

        <Form.Item
          name="newSuperior"
          label="Parent DN"
          extra="Change this to move the entry to a different branch"
        >
          <Input
            style={{ fontFamily: "monospace", fontSize: 12 }}
            addonAfter={
              <DnPickerButton
                onSelect={dn => form.setFieldValue("newSuperior", dn)}
                tooltip="Browse tree to select new parent"
              />
            }
          />
        </Form.Item>

        {/* Live preview */}
        <Form.Item
          noStyle
          shouldUpdate
        >
          {() => (
            <div style={{ padding: "8px 12px", background: "#f6f8ff", borderRadius: 6, border: "1px solid #d0e0ff" }}>
              <Text type="secondary" style={{ fontSize: 11 }}>New DN preview:</Text>
              <br />
              <Text code style={{ fontSize: 11, wordBreak: "break-all" }}>
                {getPreviewDn()}
              </Text>
            </div>
          )}
        </Form.Item>

      </Form>
    </Modal>
  );
};

export default RenameEntryModal;

