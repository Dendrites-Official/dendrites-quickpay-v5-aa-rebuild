import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || "";
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const directDbUrl =
  process.env.SUPABASE_DB_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  "";

if (!supabaseUrl || !serviceRole) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

const logSection = (title) => {
  console.log("\n" + "=".repeat(72));
  console.log(title);
  console.log("=".repeat(72));
};

async function listTablesInfoSchema() {
  const info = supabase.schema("information_schema");
  const { data, error } = await info
    .from("tables")
    .select("table_name, table_schema")
    .eq("table_schema", "public")
    .or(
      "table_name.ilike.qp_sponsorship%,table_name.ilike.sponsorship%,table_name.eq.qp_requests,table_name.eq.qp_chain_snapshots"
    )
    .order("table_name", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function listColumnsInfoSchema(tableName) {
  const info = supabase.schema("information_schema");
  const { data, error } = await info
    .from("columns")
    .select("column_name,data_type,is_nullable")
    .eq("table_schema", "public")
    .eq("table_name", tableName)
    .order("ordinal_position", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function listConstraintsInfoSchema(tableName) {
  const info = supabase.schema("information_schema");
  const { data, error } = await info
    .from("table_constraints")
    .select("constraint_name,constraint_type")
    .eq("table_schema", "public")
    .eq("table_name", tableName)
    .order("constraint_name", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function listConstraintColumnsInfoSchema(tableName) {
  const info = supabase.schema("information_schema");
  const { data, error } = await info
    .from("key_column_usage")
    .select("constraint_name,column_name")
    .eq("table_schema", "public")
    .eq("table_name", tableName)
    .order("constraint_name", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function listTablesPgCatalog() {
  const pg = supabase.schema("pg_catalog");
  const { data, error } = await pg
    .from("pg_tables")
    .select("schemaname,tablename")
    .eq("schemaname", "public")
    .order("tablename", { ascending: true });
  if (error) throw error;
  const filtered = (data || []).filter((row) =>
    /^(qp_sponsorship|sponsorship)/i.test(row.tablename) ||
    ["qp_requests", "qp_chain_snapshots"].includes(row.tablename)
  );
  return filtered.map((row) => ({ table_schema: row.schemaname, table_name: row.tablename }));
}

async function getPublicNamespaceOid() {
  const pg = supabase.schema("pg_catalog");
  const { data, error } = await pg
    .from("pg_namespace")
    .select("oid,nspname")
    .eq("nspname", "public")
    .maybeSingle();
  if (error) throw error;
  return data?.oid ?? null;
}

async function getTableOid(tableName, publicOid) {
  const pg = supabase.schema("pg_catalog");
  const { data, error } = await pg
    .from("pg_class")
    .select("oid,relname,relnamespace")
    .eq("relname", tableName)
    .eq("relnamespace", publicOid)
    .maybeSingle();
  if (error) throw error;
  return data?.oid ?? null;
}

async function listColumnsPgCatalog(tableName, publicOid) {
  const tableOid = await getTableOid(tableName, publicOid);
  if (!tableOid) return [];
  const pg = supabase.schema("pg_catalog");
  const { data: attrs, error } = await pg
    .from("pg_attribute")
    .select("attname,attnum,atttypid,attnotnull,attisdropped")
    .eq("attrelid", tableOid)
    .gt("attnum", 0)
    .eq("attisdropped", false)
    .order("attnum", { ascending: true });
  if (error) throw error;
  const typeIds = Array.from(new Set((attrs || []).map((a) => a.atttypid)));
  let typeMap = new Map();
  if (typeIds.length) {
    const { data: types } = await pg
      .from("pg_type")
      .select("oid,typname")
      .in("oid", typeIds);
    typeMap = new Map((types || []).map((t) => [t.oid, t.typname]));
  }
  return (attrs || []).map((a) => ({
    column_name: a.attname,
    data_type: typeMap.get(a.atttypid) || String(a.atttypid),
    is_nullable: a.attnotnull ? "NO" : "YES",
  }));
}

async function listConstraintsPgCatalog(tableName, publicOid) {
  const tableOid = await getTableOid(tableName, publicOid);
  if (!tableOid) return { constraints: [], constraintCols: [] };
  const pg = supabase.schema("pg_catalog");
  const { data: constraints, error } = await pg
    .from("pg_constraint")
    .select("conname,contype,conkey")
    .eq("conrelid", tableOid);
  if (error) throw error;

  const { data: attrs } = await pg
    .from("pg_attribute")
    .select("attname,attnum")
    .eq("attrelid", tableOid)
    .gt("attnum", 0)
    .eq("attisdropped", false);
  const attrMap = new Map((attrs || []).map((a) => [a.attnum, a.attname]));

  const normalizedConstraints = (constraints || []).map((c) => ({
    constraint_name: c.conname,
    constraint_type: c.contype === "p" ? "PRIMARY KEY" : c.contype === "u" ? "UNIQUE" : c.contype,
  }));

  const constraintCols = [];
  for (const c of constraints || []) {
    const keys = Array.isArray(c.conkey) ? c.conkey : [];
    for (const key of keys) {
      const name = attrMap.get(key);
      if (name) {
        constraintCols.push({ constraint_name: c.conname, column_name: name });
      }
    }
  }

  return { constraints: normalizedConstraints, constraintCols };
}

async function inspectViaDirectPg() {
  if (!directDbUrl) {
    throw new Error("No direct DB URL found (SUPABASE_DB_URL / DATABASE_URL / POSTGRES_URL)." );
  }
  const { Client } = await import("pg");
  const client = new Client({ connectionString: directDbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const tablesResult = await client.query(
    `select table_name, table_schema
     from information_schema.tables
     where table_schema='public'
       and (table_name ilike 'qp_sponsorship%'
            or table_name ilike 'sponsorship%'
            or table_name in ('qp_requests','qp_chain_snapshots'))
     order by table_name`
  );
  const tables = tablesResult.rows || [];

  const getColumns = async (tableName) => {
    const res = await client.query(
      `select column_name, data_type, is_nullable
       from information_schema.columns
       where table_schema='public' and table_name=$1
       order by ordinal_position`,
      [tableName]
    );
    return res.rows || [];
  };

  const getConstraints = async (tableName) => {
    const res = await client.query(
      `select tc.constraint_name, tc.constraint_type, kcu.column_name
       from information_schema.table_constraints tc
       left join information_schema.key_column_usage kcu
         on tc.constraint_name = kcu.constraint_name
        and tc.table_schema = kcu.table_schema
        and tc.table_name = kcu.table_name
       where tc.table_schema='public' and tc.table_name=$1
       order by tc.constraint_name`,
      [tableName]
    );
    return res.rows || [];
  };

  return { tables, getColumns, getConstraints, client };
}

function printColumns(columns) {
  if (!columns.length) {
    console.log("  (no columns found)");
    return;
  }
  for (const col of columns) {
    console.log(`  - ${col.column_name} (${col.data_type}) ${col.is_nullable === "YES" ? "NULL" : "NOT NULL"}`);
  }
}

function printConstraints(constraints, constraintCols) {
  if (!constraints.length) {
    console.log("  (no constraints found)");
    return;
  }
  const colsByConstraint = new Map();
  for (const entry of constraintCols) {
    const list = colsByConstraint.get(entry.constraint_name) ?? [];
    list.push(entry.column_name);
    colsByConstraint.set(entry.constraint_name, list);
  }
  for (const row of constraints) {
    const cols = colsByConstraint.get(row.constraint_name) || [];
    const colsLabel = cols.length ? ` [${cols.join(", ")}]` : "";
    console.log(`  - ${row.constraint_name} (${row.constraint_type})${colsLabel}`);
  }
}

function printSchemaSource(source) {
  const label = source === "direct" ? "direct_pg" : source ? "pg_catalog" : "information_schema";
  console.log(`Schema source: ${label}`);
}

function hasColumns(columns, names) {
  const set = new Set(columns.map((c) => c.column_name));
  return names.every((name) => set.has(name));
}

async function main() {
  logSection("Supabase schema inspection (QuickPay)");

  let tables = [];
  let usingCatalog = false;
  let publicOid = null;
  let directPg = null;
  try {
    tables = await listTablesInfoSchema();
  } catch (err) {
    const message = err?.message || String(err);
    if (message.toLowerCase().includes("invalid schema") || message.toLowerCase().includes("schema cache")) {
      try {
        usingCatalog = true;
        publicOid = await getPublicNamespaceOid();
        tables = await listTablesPgCatalog();
      } catch (catalogErr) {
        usingCatalog = false;
        const pgResult = await inspectViaDirectPg();
        directPg = pgResult;
        tables = pgResult.tables;
      }
    } else {
      throw err;
    }
  }
  printSchemaSource(usingCatalog ? true : directPg ? "direct" : false);
  console.log("Tables (filtered):");
  if (!tables.length) {
    console.log("  (none found)");
  } else {
    for (const t of tables) {
      console.log(`  - ${t.table_schema}.${t.table_name}`);
    }
  }

  const tableNames = tables.map((t) => t.table_name);
  const hasSponsorship = tableNames.includes("qp_sponsorship_costs");
  console.log("\nqp_sponsorship_costs exists:", hasSponsorship ? "YES" : "NO");

  if (hasSponsorship) {
    logSection("qp_sponsorship_costs columns");
    const columns = directPg
      ? await directPg.getColumns("qp_sponsorship_costs")
      : usingCatalog
        ? await listColumnsPgCatalog("qp_sponsorship_costs", publicOid)
        : await listColumnsInfoSchema("qp_sponsorship_costs");
    printColumns(columns);

    logSection("qp_sponsorship_costs constraints");
    if (directPg) {
      const rows = await directPg.getConstraints("qp_sponsorship_costs");
      const constraints = [];
      const constraintCols = [];
      const seen = new Set();
      for (const row of rows) {
        if (!seen.has(row.constraint_name)) {
          constraints.push({ constraint_name: row.constraint_name, constraint_type: row.constraint_type });
          seen.add(row.constraint_name);
        }
        if (row.column_name) {
          constraintCols.push({ constraint_name: row.constraint_name, column_name: row.column_name });
        }
      }
      printConstraints(constraints, constraintCols);
    } else if (usingCatalog) {
      const { constraints, constraintCols } = await listConstraintsPgCatalog("qp_sponsorship_costs", publicOid);
      printConstraints(constraints, constraintCols);
    } else {
      const constraints = await listConstraintsInfoSchema("qp_sponsorship_costs");
      const constraintCols = await listConstraintColumnsInfoSchema("qp_sponsorship_costs");
      printConstraints(constraints, constraintCols);
    }
  }

  if (tableNames.includes("qp_requests")) {
    logSection("qp_requests columns (gas tracking?)");
    const columns = directPg
      ? await directPg.getColumns("qp_requests")
      : usingCatalog
        ? await listColumnsPgCatalog("qp_requests", publicOid)
        : await listColumnsInfoSchema("qp_requests");
    printColumns(columns.filter((col) =>
      ["gas_used", "effective_gas_price", "effective_gas_price_wei", "eth_cost_wei"].includes(col.column_name)
    ));
    const hasGasColumns = hasColumns(columns, ["gas_used", "eth_cost_wei"]);
    console.log("\nqp_requests has gas fields:", hasGasColumns ? "YES" : "NO");
  } else {
    logSection("qp_requests not found");
  }

  if (tableNames.includes("qp_chain_snapshots")) {
    logSection("qp_chain_snapshots columns (meta?)");
    const columns = directPg
      ? await directPg.getColumns("qp_chain_snapshots")
      : usingCatalog
        ? await listColumnsPgCatalog("qp_chain_snapshots", publicOid)
        : await listColumnsInfoSchema("qp_chain_snapshots");
    printColumns(columns);
  }

  logSection("Decision helper");
  if (hasSponsorship) {
    console.log("FOUND existing table: qp_sponsorship_costs");
    console.log("Canonical table: qp_sponsorship_costs");
    console.log("Migration: ALTER existing table to add missing columns/indexes if any.");
  } else if (tableNames.includes("qp_requests")) {
    console.log("NO existing qp_sponsorship_costs table.");
    console.log("qp_requests exists; consider if gas fields are present and acceptable for storage.");
    console.log("Migration: CREATE qp_sponsorship_costs if needed, or ALTER qp_requests if chosen.");
  } else {
    console.log("NO existing sponsorship table found.");
    console.log("Canonical table: qp_sponsorship_costs (new)");
    console.log("Migration: CREATE qp_sponsorship_costs.");
  }

  logSection("Next step");
  console.log("Run locally:");
  console.log("  node apps/quickpay-api/scripts/inspect_supabase_schema.mjs");

  if (directPg?.client) {
    await directPg.client.end();
  }
}

main().catch((err) => {
  console.error("Schema inspection failed:", err?.message || String(err));
  process.exit(1);
});
