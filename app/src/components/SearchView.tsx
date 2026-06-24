import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AutoComplete, Input, Select, Button, Tag, Typography,
  Empty, Spin, Tooltip, Popover, Tree, Modal, Form, Splitter, Switch, InputNumber, Alert,
} from "antd";
import type { TreeDataNode as DataNode } from "antd";
import {
  SearchOutlined, ApartmentOutlined, FilterOutlined,
  FileTextOutlined, QuestionCircleOutlined,
  StarOutlined, StarFilled, DeleteOutlined, StopOutlined, SettingOutlined, TagsOutlined,
  EditOutlined,
} from "@ant-design/icons";
import { v4 as uuidv4 } from "uuid";
import { useAppStore } from "../store/appStore";
import type { LdapEntry, SavedSearch } from "../types";
import { buildFilterOptions, FilterBuilder } from "./FilterInput";
import EntryDetails from "./EntryDetails";

const { Text } = Typography;

// ─── Mini DIT browser used inside the popover ────────────────────────────────

interface MiniTreeProps {
  onSelect: (dn: string) => void;
}

const MiniDitTree: React.FC<MiniTreeProps> = ({ onSelect }) => {
  const { serverInfo, loadChildren } = useAppStore();
  const [treeData, setTreeData] = useState<DataNode[]>([]);
  const loadedKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!serverInfo?.activeBaseDn) return;
    const root: DataNode = {
      key: serverInfo.activeBaseDn,
      title: serverInfo.activeBaseDn,
      isLeaf: false,
    };
    setTreeData([root]);
  }, [serverInfo]);

  const onLoadData = useCallback(async (node: DataNode) => {
    const dn = node.key as string;
    if (loadedKeys.current.has(dn)) return;
    const page = await loadChildren(dn);
    const childNodes: DataNode[] = page.nodes.map((c) => ({
      key:    c.dn,
      title:  c.rdn,
      isLeaf: !c.hasChildren,
    }));
    if (page.hasMore) childNodes.push({ key: `__more__${dn}`, title: "📥 Last flere...", isLeaf: true });
    setTreeData((prev) => updateTree(prev, dn, childNodes));
    loadedKeys.current.add(dn);
  }, [loadChildren]);

  return (
    <Tree
      loadData={onLoadData}
      treeData={treeData}
      onSelect={(keys) => {
        const dn = keys[0] as string | undefined;
        if (dn) onSelect(dn);
      }}
      style={{ minWidth: 300, maxHeight: 360, overflowY: "auto" }}
      blockNode
    />
  );
};

function updateTree(list: DataNode[], key: string, children: DataNode[]): DataNode[] {
  return list.map((n) => {
    if (n.key === key) return { ...n, children };
    if (n.children) return { ...n, children: updateTree(n.children, key, children) };
    return n;
  });
}

// ─── Compact result item ──────────────────────────────────────────────────────

const ResultItem: React.FC<{ entry: LdapEntry; selected: boolean; showOc: boolean; onClick: () => void }> = ({
  entry,
  selected,
  showOc,
  onClick,
}) => {
  const rdn = entry.dn.split(",")[0] ?? entry.dn;
  const rest = entry.dn.slice(rdn.length + 1);
  const ocs = entry.attributes.find((a) => a.name === "objectClass")?.values ?? [];

  return (
    <div
      onClick={onClick}
      style={{
        padding: "6px 12px",
        cursor: "pointer",
        borderLeft: selected ? "3px solid #1677ff" : "3px solid transparent",
        background: selected ? "#e6f4ff" : "transparent",
        borderBottom: "1px solid #f0f0f0",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <FileTextOutlined style={{ color: "#1677ff", flexShrink: 0 }} />
        <Text strong style={{ fontSize: 12 }}>{rdn}</Text>
        {showOc && ocs.slice(0, 2).map((oc) => (
          <Tag key={oc} color="blue" style={{ fontSize: 10, margin: 0 }}>{oc}</Tag>
        ))}
      </div>
      {rest && (
        <Text
          type="secondary"
          style={{ fontSize: 10, marginLeft: 22, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {rest}
        </Text>
      )}
    </div>
  );
};

// ─── Filter help popover ─────────────────────────────────────────────────────

const EXAMPLES = [
  { label: "All entries",               filter: "(objectClass=*)" },
  { label: "Persons",                   filter: "(objectClass=person)" },
  { label: "inetOrgPerson",             filter: "(objectClass=inetOrgPerson)" },
  { label: "Organisational units",      filter: "(objectClass=organizationalUnit)" },
  { label: "Groups",                    filter: "(objectClass=groupOfNames)" },
  { label: "Search by cn (exact)",      filter: "(cn=John Smith)" },
  { label: "Search by cn (wildcard)",   filter: "(cn=John*)" },
  { label: "Search by email",           filter: "(mail=*@example.com)" },
  { label: "uid exists",                filter: "(uid=*)" },
  { label: "Person with cn wildcard",   filter: "(&(objectClass=person)(cn=*))" },
  { label: "Person OR group",           filter: "(|(objectClass=person)(objectClass=groupOfNames))" },
  { label: "Not disabled (AD-style)",   filter: "(!( pwdAccountLockedTime=*))" },
];

const SYNTAX = [
  { op: "(attr=value)",    desc: "Equals" },
  { op: "(attr=*)",        desc: "Attribute present" },
  { op: "(attr=val*)",     desc: "Starts with" },
  { op: "(attr=*val*)",    desc: "Contains" },
  { op: "(attr~=value)",   desc: "Approximate match" },
  { op: "(attr>=value)",   desc: "Greater or equal" },
  { op: "(attr<=value)",   desc: "Less or equal" },
  { op: "(&(A)(B))",       desc: "AND — both must match" },
  { op: "(|(A)(B))",       desc: "OR — one of them" },
  { op: "(!(A))",          desc: "NOT — negation" },
];

const FilterHelp: React.FC<{ onUse: (filter: string) => void }> = ({ onUse }) => (
  <div style={{ width: 420 }}>
    <Text strong style={{ fontSize: 12 }}>Example filters</Text>
    <div style={{ marginTop: 6, marginBottom: 12 }}>
      {EXAMPLES.map((ex) => (
        <div
          key={ex.filter}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "3px 0",
            borderBottom: "1px solid #f0f0f0",
            gap: 8,
          }}
        >
          <Text style={{ fontSize: 11, color: "#555", flex: "0 0 180px" }}>{ex.label}</Text>
          <Text code style={{ fontSize: 11, flex: 1 }}>{ex.filter}</Text>
          <Button
            size="small"
            type="link"
            style={{ padding: 0, fontSize: 11 }}
            onClick={() => onUse(ex.filter)}
          >
            Use
          </Button>
        </div>
      ))}
    </div>

    <Text strong style={{ fontSize: 12 }}>Syntaksreferanse</Text>
    <div style={{ marginTop: 6 }}>
      {SYNTAX.map((s) => (
        <div key={s.op} style={{ display: "flex", gap: 12, padding: "2px 0" }}>
          <Text code style={{ fontSize: 11, flex: "0 0 160px" }}>{s.op}</Text>
          <Text style={{ fontSize: 11, color: "#555" }}>{s.desc}</Text>
        </div>
      ))}
    </div>
  </div>
);

// ─── Generate a readable default name from filter + base ─────────────────────

function generateSearchName(filter: string, base: string): string {
  // Strip outer parens for simple filters, use filter text as hint
  const stripped = filter.replace(/^\(+|\)+$/g, "").trim();
  const hint = stripped.length > 0 && stripped.length <= 40 ? stripped : filter.slice(0, 40);
  const base_short = base.split(",")[0] ?? base;
  return `${hint} @ ${base_short}`;
}

// ─── SaveSearchModal ──────────────────────────────────────────────────────────

interface SaveSearchModalProps {
  open: boolean;
  initial: Partial<SavedSearch> & { filter: string; baseDn: string; scope: string };
  onSave: (s: SavedSearch) => void;
  onCancel: () => void;
  schema: import("../types").SchemaInfo | null;
}

const SaveSearchModal: React.FC<SaveSearchModalProps> = ({ open, initial, onSave, onCancel, schema }) => {
  const [form] = Form.useForm<{ name: string; baseDn: string; filter: string; scope: string }>();
  const [dnPickerOpen, setDnPickerOpen] = useState(false);
  const { loadChildren, serverInfo } = useAppStore();
  const [filterVal, setFilterVal] = useState(initial.filter);

  // MiniDitTree state scoped to this modal
  const [treeData, setTreeData] = useState<DataNode[]>(() => {
    if (serverInfo?.namingContexts?.length) {
      return serverInfo.namingContexts.map((nc) => ({ key: nc, title: nc, isLeaf: false }));
    }
    if (serverInfo?.activeBaseDn) {
      return [{ key: serverInfo.activeBaseDn, title: serverInfo.activeBaseDn, isLeaf: false }];
    }
    return [];
  });
  const loadedKeys = useRef<Set<string>>(new Set());

  const onLoadData = useCallback(async (node: DataNode) => {
    const dn = node.key as string;
    if (loadedKeys.current.has(dn)) return;
    const page = await loadChildren(dn);
    const childNodes: DataNode[] = page.nodes.map((c) => ({ key: c.dn, title: c.rdn, isLeaf: !c.hasChildren }));
    setTreeData((prev) => updateTree(prev, dn, childNodes));
    loadedKeys.current.add(dn);
  }, [loadChildren]);

  const handleOk = () => {
    const vals = form.getFieldsValue();
    const name = vals.name?.trim() || generateSearchName(vals.filter, vals.baseDn);
    onSave({
      id:     initial.id ?? uuidv4(),
      name,
      baseDn: vals.baseDn,
      filter: vals.filter,
      scope:  vals.scope,
    });
  };

  const isEdit = !!initial.id;

  return (
    <Modal
      open={open}
      title={<span><StarOutlined style={{ marginRight: 6, color: "#faad14" }} />{isEdit ? "Edit saved search" : "Save search"}</span>}
      onCancel={onCancel}
      onOk={handleOk}
      okText={isEdit ? "Update" : "Save"}
      cancelText="Cancel"
      width={460}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        size="small"
        onFinish={handleOk}
        initialValues={{
          name:   initial.name ?? "",
          baseDn: initial.baseDn,
          filter: initial.filter,
          scope:  initial.scope,
        }}
      >

        <Form.Item name="name" label="Navn">
          <Input
            placeholder={generateSearchName(initial.filter, initial.baseDn)}
            autoFocus
            onPressEnter={handleOk}
          />
        </Form.Item>

        <Form.Item name="baseDn" label="Base DN" rules={[{ required: true }]}>
          <Input
            style={{ fontFamily: "monospace", fontSize: 12 }}
            addonAfter={
              <Popover
                open={dnPickerOpen}
                onOpenChange={setDnPickerOpen}
                trigger="click"
                placement="bottomRight"
                title={<span style={{ fontSize: 12 }}><ApartmentOutlined style={{ marginRight: 6 }} />Select base DN</span>}
                content={
                  <Tree
                    loadData={onLoadData}
                    treeData={treeData}
                    onSelect={(keys) => {
                      const dn = keys[0] as string | undefined;
                      if (dn) { form.setFieldValue("baseDn", dn); setDnPickerOpen(false); }
                    }}
                    style={{ minWidth: 300, maxHeight: 340, overflowY: "auto" }}
                    blockNode
                  />
                }
                overlayStyle={{ width: 340 }}
              >
                <ApartmentOutlined style={{ cursor: "pointer", color: "#1677ff" }} />
              </Popover>
            }
          />
        </Form.Item>

        <Form.Item name="scope" label="Scope">
          <Select
            options={[
              { value: "base", label: "Base" },
              { value: "one",  label: "One level" },
              { value: "sub",  label: "Subtree" },
            ]}
          />
        </Form.Item>

        <Form.Item name="filter" label="Filter" rules={[{ required: true }]}>
          <AutoComplete
            options={buildFilterOptions(filterVal, schema)}
            style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
            filterOption={false}
            onChange={setFilterVal}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleOk(); } }}
            placeholder="(objectClass=*)"
          />
        </Form.Item>

      </Form>
    </Modal>
  );
};

// ─── SearchView ───────────────────────────────────────────────────────────────

const SearchView: React.FC = () => {
  const {
    serverInfo, runSearch, loadNextPage, cancelSearch,
    searchResults, searchLoading, searchHasMore, searchPage, searchTotal, searchError, pageSize,
    selectEntry, connected, selectedDn, schema,
    savedSearches, saveSearch, removeSavedSearch, setPageSize,
    showOcSearch, setShowOcSearch,
    searchSplitSize, setSearchSplitSize,
    activeProfile,
  } = useAppStore();

  const [base, setBase]               = useState(selectedDn ?? serverInfo?.activeBaseDn ?? "");
  const [filter, setFilter]           = useState("(objectClass=*)");
  const [scope, setScope]             = useState("sub");
  const [pickerOpen, setPickerOpen]   = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [helpOpen, setHelpOpen]       = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [editingSearch, setEditingSearch] = useState<SavedSearch | null>(null);
  const [activeDn, setActiveDn]       = useState<string | null>(null);
  const [pageSizePopover, setPageSizePopover] = useState(false);
  const [pageSizeDraft,   setPageSizeDraft]   = useState<number>(pageSize);
  const selectingFromResults          = useRef(false);

  // Only update base DN from tree navigation — NOT when clicking a search result
  useEffect(() => {
    if (selectingFromResults.current) {
      selectingFromResults.current = false;
      return;
    }
    if (selectedDn) setBase(selectedDn);
  }, [selectedDn]);

  // Reset base DN when server changes (new connection)
  useEffect(() => {
    if (serverInfo?.activeBaseDn) setBase(serverInfo.activeBaseDn);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverInfo?.activeBaseDn]);

  const handleSearch = () => {
    if (!base || !filter) return;
    setActiveDn(null);
    runSearch(base, filter, scope);
  };

  const handleApplySaved = (s: SavedSearch) => {
    setBase(s.baseDn);
    setFilter(s.filter);
    setScope(s.scope);
    setActiveDn(null);
    runSearch(s.baseDn, s.filter, s.scope);
  };

  const handleSave = async (s: SavedSearch) => {
    await saveSearch(s);
    setSaveModalOpen(false);
    setEditingSearch(null);
  };

  const handleSelect = (dn: string) => {
    selectingFromResults.current = true;
    setActiveDn(dn);
    selectEntry(dn);
  };

  const handlePickDn = (dn: string) => {
    setBase(dn);
    setPickerOpen(false);
  };

  // Modal initial values: editing existing search OR new from current fields
  const modalInitial = editingSearch
    ? editingSearch
    : { filter, baseDn: base, scope };

  if (!connected) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Not connected" style={{ marginTop: 80 }} />;
  }

  return (
    <>
    <Splitter style={{ height: "100%" }} onResizeEnd={(sizes) => setSearchSplitSize(sizes[0])}>

      {/* ── LEFT: controls + result list ─────────────────────────────────── */}
      <Splitter.Panel
        defaultSize={searchSplitSize}
        min={260}
        max="60%"
        style={{ display: "flex", flexDirection: "column", overflow: "hidden", borderRight: "1px solid #f0f0f0" }}
      >

        {/* Search controls */}
        <div style={{ padding: "10px 12px", background: "#fafafa", borderBottom: "1px solid #f0f0f0", flexShrink: 0 }}>

          {/* Base DN row */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
            <Text style={{ fontSize: 11, color: "#888", whiteSpace: "nowrap" }}>Base DN</Text>
            <Input
              value={base}
              onChange={(e) => setBase(e.target.value)}
              size="small"
              style={{ flex: 1 }}
              placeholder="dc=example,dc=com"
            />
            <Popover
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              trigger="click"
              placement="bottomLeft"
              title={<span style={{ fontSize: 12 }}><ApartmentOutlined style={{ marginRight: 6 }} />Select base DN</span>}
              content={<MiniDitTree onSelect={handlePickDn} />}
              overlayStyle={{ width: 340 }}
            >
              <Tooltip title="Browse tree">
                <Button size="small" icon={<ApartmentOutlined />} />
              </Tooltip>
            </Popover>
          </div>

          {/* Scope + Filter row */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
            <Text style={{ fontSize: 11, color: "#888", whiteSpace: "nowrap" }}>Scope</Text>
            <Select
              value={scope}
              onChange={setScope}
              size="small"
              style={{ width: 110 }}
              options={[
                { value: "base", label: "Base" },
                { value: "one",  label: "One level" },
                { value: "sub",  label: "Subtree" },
              ]}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Text style={{ fontSize: 11, color: "#888", whiteSpace: "nowrap" }}>Filter</Text>
            <AutoComplete
              value={filter}
              onChange={setFilter}
              options={buildFilterOptions(filter, schema)}
              style={{ flex: 1 }}
              size="small"
              onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
              placeholder="(objectClass=*)"
              filterOption={false}
            />
            <Popover
              open={builderOpen}
              onOpenChange={setBuilderOpen}
              trigger="click"
              placement="bottomLeft"
              title={<span style={{ fontSize: 12 }}><FilterOutlined style={{ marginRight: 6 }} />Filter builder</span>}
              content={
                <FilterBuilder
                  schema={schema}
                  currentFilter={filter}
                  enterpriseBaseOid={activeProfile?.enterpriseBaseOid ?? null}
                  onUpdate={(f) => setFilter(f)}
                  onCommit={(f) => { setFilter(f); setBuilderOpen(false); }}
                />
              }
              overlayStyle={{ width: 420 }}
            >
              <Tooltip title="Build filter">
                <Button size="small" icon={<FilterOutlined />} />
              </Tooltip>
            </Popover>
            <Popover
              open={helpOpen}
              onOpenChange={setHelpOpen}
              trigger="click"
              placement="bottomRight"
              title={<span style={{ fontSize: 12 }}><QuestionCircleOutlined style={{ marginRight: 6 }} />LDAP Filter hjelp</span>}
              content={
                <FilterHelp
                  onUse={(f) => { setFilter(f); setHelpOpen(false); }}
                />
              }
              overlayStyle={{ width: 440 }}
            >
              <Tooltip title="Show examples and syntax">
                <Button size="small" icon={<QuestionCircleOutlined />} />
              </Tooltip>
            </Popover>
          </div>

          <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
            {searchLoading ? (
              <Button danger icon={<StopOutlined />} size="small" style={{ flex: 1 }} onClick={cancelSearch}>
                Cancel search
              </Button>
            ) : (
              <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch} size="small" style={{ flex: 1 }}>
                Search
              </Button>
            )}
            <Popover
              open={pageSizePopover}
              onOpenChange={(open) => {
                setPageSizePopover(open);
                if (open) setPageSizeDraft(pageSize);
              }}
              trigger="click"
              placement="bottom"
              title="Results per page"
              content={
                <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 180 }}>
                  <InputNumber
                    min={10}
                    max={10000}
                    step={50}
                    value={pageSizeDraft}
                    onChange={(v) => { if (v) setPageSizeDraft(v); }}
                    onPressEnter={() => {
                      if (pageSizeDraft > 0) { setPageSize(pageSizeDraft); setPageSizePopover(false); }
                    }}
                    style={{ width: "100%" }}
                    autoFocus
                  />
                  <Button
                    type="primary"
                    size="small"
                    block
                    onClick={() => {
                      if (pageSizeDraft > 0) { setPageSize(pageSizeDraft); setPageSizePopover(false); }
                    }}
                  >
                    Apply
                  </Button>
                </div>
              }
            >
              <Tooltip title={`Page size: ${pageSize} — click to change`}>
                <Button size="small" icon={<SettingOutlined />} />
              </Tooltip>
            </Popover>
            <Tooltip title="Save search (⭐)">
              <Button
                size="small"
                icon={<StarOutlined />}
                onClick={() => { setEditingSearch(null); setSaveModalOpen(true); }}
                disabled={!filter}
              />
            </Tooltip>
          </div>
        </div>

        {/* ── Saved searches ────────────────────────────────── */}
        {savedSearches.length > 0 && (
          <div style={{ borderBottom: "1px solid #f0f0f0", flexShrink: 0 }}>
            <div style={{ padding: "4px 12px", background: "#fffbe6", borderBottom: "1px solid #ffe58f", display: "flex", alignItems: "center", gap: 6 }}>
              <StarFilled style={{ color: "#faad14", fontSize: 11 }} />
              <Text style={{ fontSize: 11, color: "#888" }}>Saved searches</Text>
            </div>
            {savedSearches.map((s) => (
              <div
                key={s.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "5px 12px",
                  borderBottom: "1px solid #f5f5f5",
                  gap: 6,
                  cursor: "pointer",
                }}
                onClick={() => handleApplySaved(s)}
              >
                <StarFilled style={{ color: "#faad14", fontSize: 11, flexShrink: 0 }} />
                <div style={{ flex: 1, overflow: "hidden" }}>
                  <Text strong style={{ fontSize: 12, display: "block" }}>{s.name}</Text>
                  <Text type="secondary" style={{ fontSize: 10, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.baseDn} · {s.scope}
                  </Text>
                  <Text code style={{ fontSize: 10, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.filter}
                  </Text>
                </div>
                <Tooltip title="Edit">
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={(e) => { e.stopPropagation(); setEditingSearch(s); setSaveModalOpen(true); }}
                    style={{ flexShrink: 0 }}
                  />
                </Tooltip>
                <Tooltip title="Delete">
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => { e.stopPropagation(); removeSavedSearch(s.id); }}
                    style={{ flexShrink: 0 }}
                  />
                </Tooltip>
              </div>
            ))}
          </div>
        )}

        {/* Results list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {searchLoading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
              <Spin tip="Searching…" />
            </div>
          ) : searchError ? (
            <Alert
              type="error"
              showIcon
              message="Search error"
              description={searchError}
              style={{ margin: 12 }}
            />
          ) : searchResults.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No results"
              style={{ marginTop: 40 }}
            />
          ) : (
            <>
              {/* Paging summary bar */}
              <div style={{ padding: "4px 12px", background: "#f5f5f5", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    <span style={{ fontWeight: 600, color: "#1677ff" }}>{searchResults.length}</span>
                    {" "}vist{searchPage > 1 ? ` — side ${searchPage}` : ""}
                    {searchTotal > searchResults.length ? ` / ${searchTotal} totalt` : ""}
                  </Text>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {searchHasMore && (
                    <Button
                      size="small"
                      type="link"
                      loading={searchLoading}
                      onClick={loadNextPage}
                      style={{ fontSize: 11, padding: 0 }}
                    >
                      Last neste side ({pageSize}) →
                    </Button>
                  )}
                  <Tooltip title={showOcSearch ? "Hide object classes" : "Show object classes"}>
                    <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#888" }}>
                      <TagsOutlined style={{ fontSize: 11 }} />
                      <Switch size="small" checked={showOcSearch} onChange={setShowOcSearch} />
                    </span>
                  </Tooltip>
                </span>
              </div>
              {searchResults.map((entry) => (
                <ResultItem
                  key={entry.dn}
                  entry={entry}
                  selected={activeDn === entry.dn}
                  showOc={showOcSearch}
                  onClick={() => handleSelect(entry.dn)}
                />
              ))}
            </>
          )}
        </div>
      </Splitter.Panel>

      {/* ── RIGHT: entry details ──────────────────────────────────────────── */}
      <Splitter.Panel style={{ overflow: "hidden" }}>
        {activeDn ? (
          <EntryDetails />
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Click a result to view attributes"
            style={{ marginTop: 80 }}
          />
        )}
      </Splitter.Panel>
    </Splitter>

      {/* ── Save / Edit search modal ──────────────────────────────────────── */}
      <SaveSearchModal
        key={editingSearch ? `edit-${editingSearch.id}` : "new"}
        open={saveModalOpen}
        initial={modalInitial}
        schema={schema}
        onSave={handleSave}
        onCancel={() => { setSaveModalOpen(false); setEditingSearch(null); }}
      />
    </>
  );
};

export default SearchView;
