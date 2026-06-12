import React, { useState, useCallback } from "react";
import { Button, Modal, Tree, Spin, Typography, Tooltip } from "antd";
import { FolderOpenOutlined, FolderOutlined, ApartmentOutlined } from "@ant-design/icons";
import type { TreeProps } from "antd";
import { useAppStore } from "../store/appStore";
import * as api from "../api/commands";
import type { DitNode } from "../types";

const { Text } = Typography;

type TreeNode = NonNullable<TreeProps["treeData"]>[number];

interface Props {
  /** Called when the user confirms a selected DN */
  onSelect: (dn: string) => void;
  /** Optional tooltip for the button */
  tooltip?: string;
}

/**
 * A small button that opens a modal DIT-tree browser.
 * The user can expand nodes and click one to use it as Base DN.
 */
const DnPickerButton: React.FC<Props> = ({ onSelect, tooltip = "Browse tree" }) => {
  const { serverInfo } = useAppStore();
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [picked, setPicked]   = useState<string | null>(null);

  const rootDn = serverInfo?.activeBaseDn ?? "";

  // ── Build initial tree with just the root node ────────────────────────────
  const openModal = async () => {
    setPicked(null);
    setLoading(true);
    setOpen(true);
    try {
      const page = await api.listChildren(rootDn);
      const rootNode: TreeNode = {
        key:      rootDn,
        title:    rootDn || "(root)",
        icon:     <ApartmentOutlined />,
        isLeaf:   false,
        children: page.nodes.map(n => makeLeaf(n)),
      };
      setTreeData([rootNode]);
    } catch {
      setTreeData([{ key: rootDn, title: rootDn || "(root)", isLeaf: true }]);
    } finally {
      setLoading(false);
    }
  };

  const makeLeaf = (node: DitNode): TreeNode => ({
    key:    node.dn,
    title:  node.rdn,
    icon:   <FolderOutlined />,
    isLeaf: !node.hasChildren,
  });

  // ── Lazy-load children when a node is expanded ───────────────────────────
  const onLoadData = useCallback(async (node: TreeNode) => {
    const dn = String(node.key);
    const page = await api.listChildren(dn);
    const children: TreeNode[] = page.nodes.map(n => makeLeaf(n));

    setTreeData(prev => updateTreeData(prev, dn, children));
  }, []);

  // ── Confirm selection ────────────────────────────────────────────────────
  const handleOk = () => {
    if (picked) {
      onSelect(picked);
      setOpen(false);
    }
  };

  return (
    <>
      <Tooltip title={tooltip}>
        <Button
          icon={<FolderOpenOutlined />}
          size="small"
          onClick={openModal}
        />
      </Tooltip>

      <Modal
        open={open}
        title="Select Base DN"
        width={480}
        onCancel={() => setOpen(false)}
        onOk={handleOk}
        okText="Use this DN"
        okButtonProps={{ disabled: !picked }}
      >
        {loading ? (
          <div style={{ textAlign: "center", padding: 32 }}><Spin /></div>
        ) : (
          <>
            <Tree
              treeData={treeData}
              loadData={onLoadData}
              showIcon
              selectedKeys={picked ? [picked] : []}
              onSelect={keys => setPicked(keys.length > 0 ? String(keys[0]) : null)}
              style={{ maxHeight: 360, overflow: "auto" }}
            />
            {picked && (
              <div style={{ marginTop: 8, padding: "4px 8px", background: "#f5f5f5", borderRadius: 4 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Selected: </Text>
                <Text style={{ fontFamily: "monospace", fontSize: 11 }}>{picked}</Text>
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Recursively splice children into the correct node */
function updateTreeData(nodes: TreeNode[], key: string, children: TreeNode[]): TreeNode[] {
  return nodes.map(node => {
    if (node.key === key) {
      return { ...node, children: children.length > 0 ? children : undefined, isLeaf: children.length === 0 };
    }
    if (node.children) {
      return { ...node, children: updateTreeData(node.children as TreeNode[], key, children) };
    }
    return node;
  });
}

export default DnPickerButton;






