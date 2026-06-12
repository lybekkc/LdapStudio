import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Tree, Spin, Empty, Tag, Tooltip, Switch, message } from "antd";
import type { TreeDataNode as DataNode } from "antd";
import { DatabaseOutlined, FolderOutlined, UserOutlined, GroupOutlined, PlusCircleOutlined, TagsOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useAppStore } from "../store/appStore";
import type { DitNode } from "../types";
import NewEntryDrawer from "./NewEntryDrawer";

// ─── ShowOc context ───────────────────────────────────────────────────────────

const ShowOcContext = React.createContext(true);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MORE_PREFIX = "__more__";
const moreKey = (dn: string) => `${MORE_PREFIX}${dn}`;
const isMoreKey = (key: string) => key.startsWith(MORE_PREFIX);
const parentDnFromMoreKey = (key: string) => key.slice(MORE_PREFIX.length);

function iconForObjectClasses(ocs: string[]): React.ReactNode {
  const lower = ocs.map((c) => c.toLowerCase());
  if (lower.some((c) => c === "person" || c === "inetorgperson" || c === "organizationalperson"))
    return <UserOutlined />;
  if (lower.some((c) => c.includes("group")))
    return <GroupOutlined />;
  if (lower.some((c) => ["organizationalunit", "organization", "country", "locality"].includes(c)))
    return <FolderOutlined />;
  return <DatabaseOutlined />;
}

/** Title component — re-renders automatically when ShowOcContext changes */
function DitNodeTitle({ node }: { node: DitNode }) {
  const showOc = useContext(ShowOcContext);
  return (
    <span>
      {node.rdn}
      {showOc && node.objectClasses.slice(0, 2).map((oc) => (
        <Tag key={oc} color="blue" style={{ marginLeft: 6, fontSize: 10 }}>{oc}</Tag>
      ))}
    </span>
  );
}

function makeMoreNode(parentDn: string, count: number): DataNode {
  return {
    key:    moreKey(parentDn),
    title:  <span style={{ color: "#1677ff", fontSize: 12 }}>
              <PlusCircleOutlined style={{ marginRight: 4 }} />
              Last inn flere... ({count} lastet)
            </span>,
    icon:   <span />,
    isLeaf: true,
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

const DitTree: React.FC = () => {
  const { serverInfo, loadChildren, loadMoreChildren, selectEntry, selectedDn, pageSize,
          showOcBrowser, setShowOcBrowser, lastDeletedDn, activeProfile, writeUnlocked,
          clipboardEntry, ditTreeVersion, refreshDitTree } = useAppStore();
  const [treeData, setTreeData] = useState<DataNode[]>([]);
  const [loading] = useState(false);
  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const [pasteDrawerOpen, setPasteDrawerOpen] = useState(false);

  const isReadOnly = (activeProfile?.readOnly === true) && !writeUnlocked;

  // Canonical store: parentDn → { nodes, hasMore }
  const nodeMap    = useRef<Map<string, { nodes: DitNode[]; hasMore: boolean }>>(new Map());
  // Guard against duplicate onLoadData calls (React StrictMode fires effects twice in dev)
  const loadingDns = useRef<Set<string>>(new Set());

  // Build root nodes when connection changes — show all naming contexts as roots
  useEffect(() => {
    if (!serverInfo) return;
    nodeMap.current.clear();
    loadingDns.current.clear();

    // Prefer the full namingContexts list; fall back to activeBaseDn if list is empty
    const roots: string[] = serverInfo.namingContexts.length > 0
      ? serverInfo.namingContexts
      : serverInfo.activeBaseDn ? [serverInfo.activeBaseDn] : [];

    if (roots.length === 0) return;

    setTreeData(roots.map((nc) => ({
      key:    nc,
      title:  (
        <Tooltip title={`Naming context: ${nc}`} placement="right">
          <span>
            {nc}
            <Tag color="green" style={{ fontSize: 10, marginLeft: 6 }}>root</Tag>
          </span>
        </Tooltip>
      ),
      icon:   <DatabaseOutlined />,
      isLeaf: false,
    })));
  }, [serverInfo, ditTreeVersion]);  // ← also react to manual refresh

  // Remove deleted node and automatically reload its parent's children
  useEffect(() => {
    if (!lastDeletedDn) return;
    setTreeData(prev => removeNode(prev, lastDeletedDn));
    const parentDn = lastDeletedDn.includes(",")
      ? lastDeletedDn.slice(lastDeletedDn.indexOf(",") + 1)
      : "";
    if (!parentDn) return;

    // Clear from cache so a fresh load is triggered
    nodeMap.current.delete(parentDn);
    loadingDns.current.delete(parentDn);

    // Immediately reload the parent's children so the tree stays usable
    loadChildren(parentDn)
      .then((page) => {
        nodeMap.current.set(parentDn, { nodes: page.nodes, hasMore: page.hasMore });
        const childNodes: DataNode[] = page.nodes.map((n) => ({
          key:    n.dn,
          title:  <DitNodeTitle node={n} />,
          icon:   iconForObjectClasses(n.objectClasses),
          isLeaf: !n.hasChildren,
        }));
        if (page.hasMore || page.nodes.length >= pageSize) {
          childNodes.push(makeMoreNode(parentDn, childNodes.length));
        }
        setTreeData(prev => updateTree(prev, parentDn, childNodes));
      })
      .catch(() => {
        // Fallback: just clear children so user can re-expand manually
        setTreeData(prev => clearChildren(prev, parentDn));
      });
  }, [lastDeletedDn, loadChildren, pageSize]);

  // Listen for paste-entry event (fired by ⌘V keyboard shortcut)
  useEffect(() => {
    const handler = () => {
      if (clipboardEntry) setPasteDrawerOpen(true);
    };
    window.addEventListener("paste-entry", handler);
    return () => window.removeEventListener("paste-entry", handler);
  }, [clipboardEntry]);

  // Load children for a node (called by Ant Tree when expanding)
  // showOc NOT in deps — titles are rendered by DitNodeTitle via context
  const onLoadData = useCallback(async (node: DataNode): Promise<void> => {
    const dn = node.key as string;
    if (isMoreKey(dn)) return;
    if (loadingDns.current.has(dn) || nodeMap.current.has(dn)) return;
    loadingDns.current.add(dn);
    try {
      const page = await loadChildren(dn);
      nodeMap.current.set(dn, { nodes: page.nodes, hasMore: page.hasMore });
      const childNodes: DataNode[] = page.nodes.map((n) => ({
        key:    n.dn,
        title:  <DitNodeTitle node={n} />,
        icon:   iconForObjectClasses(n.objectClasses),
        isLeaf: !n.hasChildren,
      }));
      if (page.hasMore || page.nodes.length >= pageSize) {
        childNodes.push(makeMoreNode(dn, childNodes.length));
      }
      setTreeData((prev) => updateTree(prev, dn, childNodes));
    } catch (e) {
      message.error(`Feil ved lasting: ${e}`);
    } finally {
      loadingDns.current.delete(dn);
    }
  }, [loadChildren, pageSize]);

  const onSelect = useCallback(async (keys: React.Key[]) => {
    const key = keys[0] as string | undefined;
    if (!key) return;

    if (isMoreKey(key)) {
      const parentDn = parentDnFromMoreKey(key);
      try {
        const page = await loadMoreChildren(parentDn);
        const existing = nodeMap.current.get(parentDn);
        const allNodes = [...(existing?.nodes ?? []), ...page.nodes];
        nodeMap.current.set(parentDn, { nodes: allNodes, hasMore: page.hasMore });

        const newNodes: DataNode[] = page.nodes.map((n) => ({
          key:    n.dn,
          title:  <DitNodeTitle node={n} />,
          icon:   iconForObjectClasses(n.objectClasses),
          isLeaf: !n.hasChildren,
        }));
        const totalCount = allNodes.length;
        if (page.hasMore || page.nodes.length >= pageSize) {
          newNodes.push(makeMoreNode(parentDn, totalCount));
        }
        setTreeData((prev) => appendTree(prev, parentDn, key, newNodes));
      } catch (e) {
        message.error(`Feil: ${e}`);
      }
      return;
    }
    selectEntry(key);
  }, [loadMoreChildren, selectEntry, pageSize]);

  if (!serverInfo) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Not connected" style={{ marginTop: 40 }} />;
  if (loading)     return <Spin style={{ margin: 24 }} />;

  const newEntryParent = selectedDn ?? serverInfo.activeBaseDn;

  return (
    <ShowOcContext.Provider value={showOcBrowser}>
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {/* Toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                      borderBottom: "1px solid #f0f0f0", background: "#fafafa", flexShrink: 0 }}>
          <TagsOutlined style={{ color: "#999", fontSize: 12 }} />
          <span style={{ fontSize: 11, color: "#666" }}>Object Classes</span>
          <Tooltip title={showOcBrowser ? "Skjul" : "Vis"}>
            <Switch size="small" checked={showOcBrowser} onChange={setShowOcBrowser} />
          </Tooltip>
          <div style={{ flex: 1 }} />
          <Tooltip title="Oppdater tre (F5)">
            <ReloadOutlined
              style={{ color: "#888", cursor: "pointer", fontSize: 13, marginRight: 4 }}
              onClick={refreshDitTree}
            />
          </Tooltip>
          <Tooltip title={isReadOnly ? "Read-only — lås opp for å opprette entries" : `Ny entry under: ${newEntryParent}`}>
            <PlusOutlined
              style={{ color: isReadOnly ? "#aaa" : "#1677ff", cursor: isReadOnly ? "not-allowed" : "pointer", fontSize: 14 }}
              onClick={() => !isReadOnly && setNewEntryOpen(true)}
            />
          </Tooltip>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          <Tree
            showIcon
            loadData={onLoadData}
            treeData={treeData}
            onSelect={onSelect}
            selectedKeys={selectedDn ? [selectedDn] : []}
            style={{ padding: "6px 4px" }}
            blockNode
          />
        </div>
      </div>

      <NewEntryDrawer
        open={newEntryOpen || pasteDrawerOpen}
        parentDn={newEntryParent}
        prefill={pasteDrawerOpen ? clipboardEntry : null}
        onClose={() => { setNewEntryOpen(false); setPasteDrawerOpen(false); }}
        onCreated={(dn) => {
          // Reload the parent node so the new entry appears
          const parent = dn.substring(dn.indexOf(",") + 1);
          nodeMap.current.delete(parent);
          loadingDns.current.delete(parent);
          setTreeData(prev => clearChildren(prev, parent));
        }}
      />
    </ShowOcContext.Provider>
  );
};

// ─── Pure tree helpers ────────────────────────────────────────────────────────

function updateTree(list: DataNode[], key: string, children: DataNode[]): DataNode[] {
  return list.map((n) => {
    if (n.key === key) return { ...n, children };
    if (n.children) return { ...n, children: updateTree(n.children, key, children) };
    return n;
  });
}

function appendTree(list: DataNode[], parentKey: string, removeKey: string, add: DataNode[]): DataNode[] {
  return list.map((n) => {
    if (n.key === parentKey && n.children) {
      const without = n.children.filter((c) => c.key !== removeKey);
      return { ...n, children: [...without, ...add] };
    }
    if (n.children) return { ...n, children: appendTree(n.children, parentKey, removeKey, add) };
    return n;
  });
}

/** Remove cached children so tree re-loads them on next expand */
function clearChildren(list: DataNode[], key: string): DataNode[] {
  return list.map((n) => {
    if (n.key === key) return { ...n, children: undefined };
    if (n.children) return { ...n, children: clearChildren(n.children, key) };
    return n;
  });
}

/** Remove a node entirely from the tree */
function removeNode(list: DataNode[], key: string): DataNode[] {
  return list
    .filter(n => n.key !== key)
    .map(n => n.children
      ? { ...n, children: removeNode(n.children, key) }
      : n
    );
}

export default DitTree;
