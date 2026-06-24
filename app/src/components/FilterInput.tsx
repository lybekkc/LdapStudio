import React, { useState } from "react";
import {
  AutoComplete,
  Button,
  Select,
  Space,
  Tag,
  Typography,
  Divider,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { SchemaInfo } from "../types";

const { Text } = Typography;

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

// ─── FilterBuilder popover content ───────────────────────────────────────────

interface FilterBuilderProps {
  schema: SchemaInfo | null;
  currentFilter: string;
  onInsert: (newFilter: string) => void;
}

export const FilterBuilder: React.FC<FilterBuilderProps> = ({ schema, currentFilter, onInsert }) => {
  const [attr, setAttr] = useState("");
  const [op, setOp]   = useState("=");
  const [val, setVal] = useState("");

  const attrOptions = (schema?.attributeTypes ?? [])
    .filter((at) => !attr || at.name.toLowerCase().includes(attr.toLowerCase()))
    .slice(0, 25)
    .map((at) => ({ value: at.name, label: at.name }));

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

  const handleInsert = () => {
    if (!clause) return;
    let next = currentFilter.trim();
    if (!next || next === "(objectClass=*)") {
      onInsert(clause);
    } else {
      // Wrap existing + new in (&...)
      onInsert(`(&${next}${clause})`);
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
        </Space.Compact>

        {/* Preview */}
        <div style={{ background: "#f5f5f5", padding: "4px 8px", borderRadius: 4 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>Preview: </Text>
          <Text code style={{ fontSize: 11 }}>{clause || "—"}</Text>
        </div>

        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          disabled={!clause}
          onClick={handleInsert}
          block
        >
          {currentFilter && currentFilter !== "(objectClass=*)"
            ? "Add to filter with AND"
            : "Set filter"}
        </Button>

        <Divider style={{ margin: "4px 0" }} />

        {/* Quick templates */}
        <div>
          <Text type="secondary" style={{ fontSize: 11 }}>Quick templates:</Text>
          <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {quickTemplates.map((t) => (
              <Tag
                key={t}
                style={{ cursor: "pointer", fontFamily: "monospace", fontSize: 10 }}
                onClick={() => onInsert(t)}
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

