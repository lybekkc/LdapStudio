import React from "react";
import { Modal, Table, Tag, Typography } from "antd";

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
}

const isMac = navigator.platform.toUpperCase().includes("MAC");
const mod = isMac ? "⌘" : "Ctrl";

const shortcuts = [
  { category: "Navigation",    key: `${mod}+1`,      action: "Switch to Browser tab"    },
  { category: "Navigation",    key: `${mod}+2`,      action: "Switch to Search tab"     },
  { category: "Navigation",    key: `${mod}+3`,      action: "Switch to Schema tab"     },
  { category: "History",       key: `${mod}+Z`,      action: "Undo last operation"      },
  { category: "History",       key: `${mod}+H`,      action: "Open operation history"   },
  { category: "Entry",         key: `${mod}+E`,      action: "Edit selected entry"      },
  { category: "Entry",         key: `${mod}+S`,      action: "Save changes (edit mode)" },
  { category: "Entry",         key: `${mod}+N`,      action: "New entry (browser tab)"  },
  { category: "Entry",         key: `${mod}+C`,      action: "Copy selected entry to clipboard" },
  { category: "Entry",         key: `${mod}+V`,      action: "Paste entry (open New Entry drawer pre-filled)" },
  { category: "Entry",         key: `Escape`,        action: "Cancel edit mode"         },
];

const CATEGORY_COLORS: Record<string, string> = {
  Navigation: "blue",
  History:    "purple",
  Entry:      "orange",
};

const ShortcutsModal: React.FC<Props> = ({ open, onClose }) => (
  <Modal
    open={open}
    title="⌨️ Keyboard Shortcuts"
    onCancel={onClose}
    footer={null}
    width={480}
  >
    <Table
      dataSource={shortcuts}
      rowKey="key"
      size="small"
      pagination={false}
      columns={[
        {
          title: "Category",
          dataIndex: "category",
          width: 110,
          render: (c: string) => <Tag color={CATEGORY_COLORS[c] ?? "default"}>{c}</Tag>,
        },
        {
          title: "Shortcut",
          dataIndex: "key",
          width: 140,
          render: (k: string) => (
            <Text code style={{ fontSize: 12 }}>{k}</Text>
          ),
        },
        {
          title: "Action",
          dataIndex: "action",
          render: (a: string) => <Text style={{ fontSize: 12 }}>{a}</Text>,
        },
      ]}
    />
  </Modal>
);

export default ShortcutsModal;

