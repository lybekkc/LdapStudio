import React, { useState, useEffect } from "react";
import {
  AutoComplete,
  Button,
  DatePicker,
  Select,
  Space,
  Tag,
  Typography,
  Divider,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import type { SchemaInfo } from "../types";

const { Text } = Typography;

// LDAP Generalized Time syntax OID
const GENERALIZED_TIME_OID = "1.3.6.1.4.1.1466.115.121.1.24";

/** Returns true if the attribute uses GeneralizedTime syntax, using schema when available. */
function isDateAttr(attrName: string, schema: SchemaInfo | null): boolean {
  if (schema) {
    const nameLower = attrName.toLowerCase();
    const def = schema.attributeTypes.find((a) =>
      a.names.some((n) => n.toLowerCase() === nameLower) ||
      a.name.toLowerCase() === nameLower
    );
    if (def) return def.syntax === GENERALIZED_TIME_OID;
    // Attribute not in schema — fall through to heuristic below
  }
  // Schema not loaded yet: name heuristic as fallback
  const name = attrName.toLowerCase();
  return name.includes("timestamp") || name.includes("time") || name.includes("date") || name.includes("expir");
}

/** Format a dayjs value as LDAP Generalized Time: 20260101120000Z */
function toGeneralizedTime(d: dayjs.Dayjs): string {
  return d.format("YYYYMMDDHHmmss") + "Z";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse the last incomplete clause being typed, e.g. "(cn" or "(objectClass=per" */
function parseCurrentClause(value: string): {
  beforeClause: string;
  attrPart: string;
  eqFound: boolean;
  valuePart: string;
  hasOpenClause: boolean;
} {
  // Find the last '(' without a matching ')'
  let depth = 0;
  let clauseStart = -1;
  for (let i = value.length - 1; i >= 0; i--) {
    if (value[i] === ")") depth++;
    else if (value[i] === "(") {
      if (depth === 0) { clauseStart = i; break; }
      depth--;
    }
  }
  if (clauseStart === -1) return { beforeClause: value, attrPart: "", eqFound: false, valuePart: "", hasOpenClause: false };

  const clause = value.slice(clauseStart + 1);
  const beforeClause = value.slice(0, clauseStart + 1);
  const eqIdx = clause.indexOf("=");

  if (eqIdx === -1) {
    return { beforeClause, attrPart: clause, eqFound: false, valuePart: "", hasOpenClause: true };
  }
  return {
    beforeClause,
    attrPart: clause.slice(0, eqIdx),
    eqFound: true,
    valuePart: clause.slice(eqIdx + 1),
    hasOpenClause: true,
  };
}

/** Build AutoComplete options based on current filter string + schema */
export function buildFilterOptions(
  value: string,
  schema: SchemaInfo | null,
): { value: string; label: React.ReactNode }[] {
  if (!schema) return [];

  const { beforeClause, attrPart, eqFound, valuePart, hasOpenClause } = parseCurrentClause(value);

  if (!eqFound) {
    // Only suggest when inside an open, unmatched clause
    if (!hasOpenClause) return [];

    // Suggest attribute names
    const partial = attrPart.toLowerCase();
    return schema.attributeTypes
      .filter((at) => at.name.toLowerCase().startsWith(partial))
      .slice(0, 20)
      .map((at) => ({
        value: beforeClause + at.name + "=",
        label: (
          <span>
            <Text code style={{ fontSize: 11 }}>{at.name}</Text>
            {at.description && (
              <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
                {at.description.slice(0, 50)}
              </Text>
            )}
          </span>
        ),
      }));
  }

  const attr = attrPart.toLowerCase();

  if (attr === "objectclass") {
    // Suggest object class names
    const partial = valuePart.toLowerCase();
    return schema.objectClasses
      .filter((oc) => oc.name.toLowerCase().startsWith(partial))
      .slice(0, 20)
      .map((oc) => ({
        value: beforeClause + attrPart + "=" + oc.name + ")",
        label: (
          <span>
            <Text code style={{ fontSize: 11 }}>{oc.name}</Text>
            <Tag
              color={oc.kind === "STRUCTURAL" ? "blue" : oc.kind === "AUXILIARY" ? "purple" : "default"}
              style={{ marginLeft: 6, fontSize: 10 }}
            >
              {oc.kind}
            </Tag>
            {oc.description && (
              <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
                {oc.description.slice(0, 40)}
              </Text>
            )}
          </span>
        ),
      }));
  }

  return [];
}

// ─── Parse a simple single-clause filter into components ─────────────────────

interface ParsedClause { attr: string; op: string; val: string; }

function parseSimpleFilter(filter: string): ParsedClause | null {
  const f = filter.trim();
  // NOT single-attr: (!(attr=val))
  const notMatch = f.match(/^\(!\(([^=~<>]+)(=|~=|>=|<=)(.+)\)\)$/);
  if (notMatch) return { attr: notMatch[1], op: "not", val: notMatch[3] };
  // Must be a single clause wrapped in parens
  if (!f.startsWith("(") || !f.endsWith(")")) return null;
  const inner = f.slice(1, f.length - 1);
  // Compound filter — can't edit as single clause
  if (inner.startsWith("&") || inner.startsWith("|") || inner.startsWith("!")) return null;
  // present: attr=*
  const presentMatch = inner.match(/^([^=~<>]+)=\*$/);
  if (presentMatch) return { attr: presentMatch[1], op: "present", val: "" };
  // substring: attr=*val*
  const subMatch = inner.match(/^([^=~<>]+)=\*(.+)\*$/);
  if (subMatch) return { attr: subMatch[1], op: "substring", val: subMatch[2] };
  // Standard comparisons
  const cmpMatch = inner.match(/^([^=~<>]+)(>=|<=|~=|=)(.*)$/);
  if (cmpMatch) return { attr: cmpMatch[1], op: cmpMatch[2], val: cmpMatch[3] };
  return null;
}

// ─── FilterBuilder popover content ───────────────────────────────────────────

interface FilterBuilderProps {
  schema: SchemaInfo | null;
  currentFilter: string;
  enterpriseBaseOid: string | null;
  onUpdate: (newFilter: string) => void; // update filter, stay open
  onCommit: (newFilter: string) => void; // update filter + close
}

export const FilterBuilder: React.FC<FilterBuilderProps> = ({ schema, currentFilter, enterpriseBaseOid, onUpdate, onCommit }) => {
  const [attr, setAttr] = useState("");
  const [op, setOp]   = useState("=");
  const [val, setVal] = useState("");

  // Pre-populate from current filter when it's a simple single clause
  useEffect(() => {
    const parsed = parseSimpleFilter(currentFilter);
    if (parsed) {
      setAttr(parsed.attr);
      setOp(parsed.op);
      setVal(parsed.val);
    }
  }, [currentFilter]);

  const showDatePicker = op !== "present" && op !== "substring" && isDateAttr(attr, schema);

  // Sort attributes: custom (enterprise OID) first, then operational, then standard
  const sortedAttrs = (schema?.attributeTypes ?? []).slice().sort((a, b) => {
    const rank = (at: typeof a) => {
      if (enterpriseBaseOid && at.oid.startsWith(enterpriseBaseOid)) return 0;
      if (at.usage !== "userApplications") return 1;
      return 2;
    };
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return a.name.localeCompare(b.name);
  });

  const attrOptions = sortedAttrs
    .filter((at) => !attr || at.name.toLowerCase().includes(attr.toLowerCase()))
    .map((at) => ({
      value: at.name,
      label: at.usage !== "userApplications"
        ? `${at.name} ⚙`
        : enterpriseBaseOid && at.oid.startsWith(enterpriseBaseOid)
          ? `★ ${at.name}`
          : at.name,
    }));

  const valOptions =
    attr.toLowerCase() === "objectclass"
      ? (schema?.objectClasses ?? [])
          .filter((oc) => !val || oc.name.toLowerCase().startsWith(val.toLowerCase()))
          .slice(0, 20)
          .map((oc) => ({ value: oc.name, label: `${oc.name} [${oc.kind}]` }))
      : [];

  const buildClause = (): string => {
    if (!attr) return "";
    if (op === "present")   return `(${attr}=*)`;
    if (op === "substring") return `(${attr}=*${val}*)`;
    if (op === "not")       return `(!(${attr}=${val}))`;
    return `(${attr}${op}${val})`;
  };

  const clause = buildClause();

  const handleAdd = (connector: "&" | "|") => {
    if (!clause) return;
    const next = currentFilter.trim();
    let newFilter: string;
    const isFirst = !next || next === "(objectClass=*)";
    if (isFirst) {
      newFilter = clause;
    } else if (next.startsWith(`(&`) && connector === "&") {
      const inner = next.slice(2, next.length - 1);
      newFilter = `(&${inner}${clause})`;
    } else if (next.startsWith(`(|`) && connector === "|") {
      const inner = next.slice(2, next.length - 1);
      newFilter = `(|${inner}${clause})`;
    } else {
      newFilter = `(${connector}${next}${clause})`;
    }
    if (isFirst) {
      onCommit(newFilter); // first clause → close builder
    } else {
      onUpdate(newFilter); // adding to existing → stay open
    }
    setAttr(""); setVal("");
  };

  const quickTemplates = [
    "(objectClass=*)",
    "(objectClass=person)",
    "(objectClass=inetOrgPerson)",
    "(objectClass=organizationalUnit)",
    "(objectClass=group)",
    "(&(objectClass=person)(cn=*))",
  ];

  return (
    <div style={{ width: 400 }}>
      <Space direction="vertical" style={{ width: "100%" }} size={8}>

        {/* Attribute + operator + value */}
        <Space.Compact style={{ width: "100%" }}>
          <AutoComplete
            value={attr}
            onChange={setAttr}
            options={attrOptions}
            placeholder="Attribute"
            style={{ width: "42%" }}
            autoFocus
            onFocus={(e) => (e.target as HTMLInputElement).select()}
            filterOption={(inp, opt) =>
              (opt?.value as string)?.toLowerCase().includes(inp.toLowerCase())
            }
          />
          <Select
            value={op}
            onChange={setOp}
            style={{ width: "26%" }}
            options={[
              { value: "=",         label: "= equals" },
              { value: "~=",        label: "~= approx" },
              { value: ">=",        label: ">= gte" },
              { value: "<=",        label: "<= lte" },
              { value: "present",   label: "present" },
              { value: "substring", label: "=*val*" },
              { value: "not",       label: "NOT" },
            ]}
          />
          {showDatePicker ? (
            <DatePicker
              showTime={{ format: "HH:mm:ss" }}
              format="YYYY-MM-DD HH:mm:ss"
              placeholder="Pick date & time"
              size="small"
              style={{ width: "32%" }}
              onChange={(d) => setVal(d ? toGeneralizedTime(d) : "")}
            />
          ) : (
            <AutoComplete
              value={val}
              onChange={setVal}
              options={valOptions}
              placeholder="Value"
              style={{ width: "32%" }}
              disabled={op === "present"}
              filterOption={(inp, opt) =>
                (opt?.value as string)?.toLowerCase().startsWith(inp.toLowerCase())
              }
            />
          )}
        </Space.Compact>

        {/* Preview */}
        <div style={{ background: "#f5f5f5", padding: "4px 8px", borderRadius: 4 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>Preview: </Text>
          <Text code style={{ fontSize: 11 }}>{clause || "—"}</Text>
        </div>

        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            disabled={!clause}
            onClick={() => handleAdd("&")}
            style={{ flex: 1 }}
          >
            {currentFilter && currentFilter !== "(objectClass=*)" ? "AND" : "Set filter"}
          </Button>
          <Button
            size="small"
            icon={<PlusOutlined />}
            disabled={!clause}
            onClick={() => handleAdd("|")}
            style={{ flex: 1 }}
          >
            OR
          </Button>
          <Button
            size="small"
            danger
            disabled={!currentFilter || currentFilter === "(objectClass=*)"}
            onClick={() => onUpdate(`(!(${currentFilter}))`)}
            title="Wrap current filter in NOT"
          >
            NOT
          </Button>
          <Button
            size="small"
            disabled={!currentFilter || currentFilter === "(objectClass=*)"}
            onClick={() => onCommit(currentFilter)}
          >
            Done
          </Button>
        </Space>

        <Divider style={{ margin: "4px 0" }} />

        {/* Quick templates */}
        <div>
          <Text type="secondary" style={{ fontSize: 11 }}>Quick templates:</Text>
          <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {quickTemplates.map((t) => (
              <Tag
                key={t}
                style={{ cursor: "pointer", fontFamily: "monospace", fontSize: 10 }}
                onClick={() => onCommit(t)}
              >
                {t}
              </Tag>
            ))}
          </div>
        </div>

      </Space>
    </div>
  );
};

