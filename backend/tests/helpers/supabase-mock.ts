/**
 * In-memory fake of the subset of the Supabase client used by the backend.
 *
 * We drive the REAL middleware and services against this fake, so the tests
 * exercise actual authorization code paths (auth -> workspace membership ->
 * permissions) rather than re-implementing them.
 *
 * Supports the query-builder subset used in the codebase:
 *   select (incl. PostgREST-style embeds), eq, neq, in, or(ilike/eq),
 *   single, maybeSingle, limit, range, order, insert, update, delete,
 *   upsert, count:'exact'
 * plus supabaseAdmin.auth.getUser(), .rpc() and .then() await semantics.
 *
 * Embed resolution:
 *   - Forward:  row has `<table>_id`  -> single related row (or null)
 *   - Reverse:  child table has `<parent>_id` -> array of related rows
 *   - Nested embeds recurse through child rows.
 *
 * This is a TEST HELPER, not a general-purpose emulator — extend it only when
 * a suite needs a query shape the codebase doesn't use yet.
 */

export type Row = Record<string, any>;

export function makeDb() {
  const tables: Record<string, Row[]> = {};
  let idCounter = 0;

  const uid = (prefix = 'id') => `${prefix}_${(++idCounter).toString(36).padStart(4, '0')}`;

  function getTable(name: string): Row[] {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  }

  function matchesOr(row: Row, orExpr: string): boolean {
    // Supports: "colA.ilike.%v%,colB.ilike.%v%" and "colA.eq.v,colB.eq.v"
    return orExpr.split(',').some((clause) => {
      const m = clause.match(/^(\w+)\.(ilike|eq)\.(.*)$/);
      if (!m) return false;
      const [, col, op, rawVal] = m;
      const val = rawVal.replace(/^%|%$/g, '');
      const cell = row[col];
      if (op === 'eq') return String(cell) === val;
      return typeof cell === 'string' && cell.toLowerCase().includes(val.toLowerCase());
    });
  }

  /** Parse one select part: "alias:table(inner)" | "table(inner)" | "col" */
  function parseSelectPart(part: string) {
    return part.trim().match(/^([\w.]+(?::[\w.]+)?|\w+:\w+)(?:\((.*)\))?$/) ||
      part.trim().match(/^(?:(\w+):)?(\w+)(?:\((.*)\))?$/);
  }

  /** Find the FK column in `childTable` rows that references a row with id `parentId` */
  function findChildFk(childTable: string, parentId: string): string | null {
    for (const r of getTable(childTable)) {
      for (const col of Object.keys(r)) {
        if (col.endsWith('_id') && col !== 'id' && r[col] === parentId) {
          return col;
        }
      }
    }
    return null;
  }

  /** Resolve a PostgREST-style select string for a row. */
  function embed(row: Row, selRaw: string): Row {
    // Normalize whitespace/newlines: real code uses multiline template literals.
    // Also collapse space before '(' so "product:products (" parses like "product:products(".
    selRaw = selRaw.replace(/\s+/g, ' ').trim().replace(/\s+\(/g, '(');
    const sel = selRaw;
    if (!sel || sel === '*') return { ...row };

    const parts: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of sel) {
      if (ch === '(') { depth++; cur += ch; }
      else if (ch === ')') { depth--; cur += ch; }
      else if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; }
      else cur += ch;
    }
    if (cur.trim()) parts.push(cur);

    // A select may mix "*" with embeds ("*, category:categories(id, name)"):
    // start from the full row, then overlay relation parts.
    const hasStar = parts.some((p) => p.trim() === '*');
    const out: Row = hasStar ? { ...row } : {};
    for (const part of parts) {
      const m = part.trim().match(/^(?:(\w+):)?(\w+)(?:\((.*)\))?$/);
      if (!m) continue;
      const alias = m[1] || m[2];
      const relTable = m[2];
      const inner = m[3];

      // Plain column reference (no alias, no parens, column exists on row)
      if (!m[1] && !inner && relTable in row) {
        out[alias] = row[relTable];
        continue;
      }

      // Forward relation: FK column on this row. PostgREST uses real FKs;
      // we approximate with `<alias>_id` (e.g. plan:subscription_plans →
      // plan_id), `<table>_id`, and the singularized form
      // (permissions -> permission_id, roles -> role_id, categories -> category_id).
      const fkCandidates = [`${alias}_id`, `${relTable}_id`, `${relTable.replace(/s$/, '')}_id`];
      const fk = fkCandidates.find((c) => c in row && row[c] != null);
      if (fk) {
        const target = getTable(relTable).find((r2) => r2.id === row[fk]);
        out[alias] = target ? embed(target, inner || '*') : null;
        continue;
      }

      // Reverse relation: rows in relTable pointing at this row
      const childFk = findChildFk(relTable, row.id);
      if (childFk) {
        let children = getTable(relTable)
          .filter((r2) => r2[childFk] === row.id)
          .map((c) => (inner ? embed(c, inner) : { ...c }));
        out[alias] = children;
        continue;
      }

      // No relation found — project nothing for this part (matches PostgREST failing loudly, but we stay lenient)
      out[alias] = null;
    }
    return out;
  }

  function resolveSelect(row: Row, sel: string): Row {
    if (!sel || sel.trim() === '*') return { ...row };
    try {
      return embed(row, sel);
    } catch {
      return { ...row }; // never let embedding break a read
    }
  }

  class Builder {
    private tbl: string;
    private opts: any;
    private filters: Array<(row: Row) => boolean> = [];
    private _select = '*';
    private _single = false;
    private _maybe = false;
    private _limit: number | null = null;
    private _range: [number, number] | null = null;
    private _orderBy: Array<{ col: string; asc: boolean; nullsFirst: boolean }> = [];
    private _orExpr: string | null = null;
    private _insertRows: Row[] | null = null;
    private _updateVals: Row | null = null;
    private _delete = false;

    constructor(tbl: string, opts?: any) {
      this.tbl = tbl;
      this.opts = opts || {};
    }

    select(sel = '*', opts?: any) {
      this._select = sel;
      if (opts) this.opts = { ...this.opts, ...opts };
      return this;
    }

    insert(rows: Row | Row[]) {
      this._insertRows = Array.isArray(rows) ? rows : [rows];
      return this;
    }

    update(vals: Row) {
      this._updateVals = vals;
      return this;
    }

    delete() {
      this._delete = true;
      return this;
    }

    upsert(vals: Row | Row[]) {
      const rows = Array.isArray(vals) ? vals : [vals];
      const table = getTable(this.tbl);
      for (const r of rows) {
        const keyCols = ['workspace_id', 'metric', 'id', 'user_id', 'email'].filter((c) => c in r);
        const existing = table.find((row) =>
          keyCols.length > 0 && keyCols.every((c) => row[c] === r[c])
        );
        if (existing) Object.assign(existing, r);
        else table.push({ ...r, id: r.id || uid('upsert') });
      }
      const resultRows = rows.map((r) => ({ ...r }));
      return Promise.resolve({ data: resultRows, error: null, count: resultRows.length, status: 200 });
    }

    eq(col: string, val: any) {
      this.filters.push((r) => r[col] === val);
      return this;
    }

    neq(col: string, val: any) {
      this.filters.push((r) => r[col] !== val);
      return this;
    }

    in(col: string, vals: any[]) {
      this.filters.push((r) => vals.includes(r[col]));
      return this;
    }

    gte(col: string, val: any) {
      // ISO-date strings compare correctly lexicographically
      this.filters.push((r) => r[col] != null && r[col] >= val);
      return this;
    }

    gt(col: string, val: any) {
      this.filters.push((r) => r[col] != null && r[col] > val);
      return this;
    }

    lt(col: string, val: any) {
      this.filters.push((r) => r[col] != null && r[col] < val);
      return this;
    }

    lte(col: string, val: any) {
      this.filters.push((r) => r[col] != null && r[col] <= val);
      return this;
    }

    is(col: string, val: any) {
      // Supabase .is() matches null / true / false exactly
      if (val === null) this.filters.push((r) => r[col] == null);
      else this.filters.push((r) => r[col] === val);
      return this;
    }

    ilike(col: string, pattern: string) {
      // PostgREST ilike: %value% substring match, case-insensitive
      const val = pattern.replace(/^%|%$/g, '').toLowerCase();
      this.filters.push((r) => typeof r[col] === 'string' && r[col].toLowerCase().includes(val));
      return this;
    }

    or(expr: string) {
      this._orExpr = expr;
      return this;
    }

    order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
      this._orderBy.push({ col, asc: opts?.ascending !== false, nullsFirst: opts?.nullsFirst !== false });
      return this;
    }

    range(from: number, to: number) {
      this._range = [from, to];
      return this;
    }

    limit(n: number) {
      this._limit = n;
      return this;
    }

    single() {
      this._single = true;
      return this._execute();
    }

    maybeSingle() {
      this._maybe = true;
      return this._execute();
    }

    then(resolve?: (v: any) => any, reject?: (e: any) => any) {
      return this._execute().then(resolve, reject);
    }

    private async _execute(): Promise<any> {
      const table = getTable(this.tbl);
      let rows = table.filter((r) => this.filters.every((f) => f(r)));
      if (this._orExpr) rows = rows.filter((r) => matchesOr(r, this._orExpr));

      const wantCount = this.opts && this.opts.count === 'exact';
      const total = rows.length;

      if (this._orderBy.length > 0) {
        // Stable multi-column sort: apply keys from LAST to FIRST so the
        // first-registered column dominates (matches SQL semantics).
        for (let i = this._orderBy.length - 1; i >= 0; i--) {
          const { col, asc, nullsFirst } = this._orderBy[i];
          rows = [...rows].sort((a, b) => {
            const av = a[col];
            const bv = b[col];
            const aNull = av == null;
            const bNull = bv == null;
            if (aNull && bNull) return 0;
            if (aNull !== bNull) return aNull === nullsFirst ? -1 : 1;
            const cmp = av === bv ? 0 : av > bv ? 1 : -1;
            return asc ? cmp : -cmp;
          });
        }
      }
      if (this._range) {
        const [from, to] = this._range;
        rows = rows.slice(from, (to ?? from) + 1);
      }
      if (this._limit != null) rows = rows.slice(0, this._limit);

      // Mutations
      if (this._insertRows) {
        const inserted = this._insertRows.map((r) => ({
          id: r.id || uid(this.tbl),
          created_at: r.created_at || new Date().toISOString(),
          ...r,
        }));
        table.push(...inserted);
        const project = (r: Row) => resolveSelect(r, this._select);
        return {
          data: this._single ? project(inserted[0]) : inserted.map(project),
          error: null,
          count: inserted.length,
          status: 201,
        };
      }

      if (this._updateVals) {
        let count = 0;
        for (const r of rows) {
          Object.assign(r, this._updateVals);
          count++;
        }
        const project = (r: Row) => resolveSelect(r, this._select);
        // supabase-js semantics: .single()/.maybeSingle() after an update
        // project to one object (PostgREST vnd.pgrst.object), and .single()
        // errors when nothing matched.
        if (this._single) {
          if (rows.length === 0) {
            return { data: null, error: { code: 'PGRST116', message: 'No rows found' }, count: 0, status: 406 };
          }
          return { data: project(rows[0]), error: null, count: 1, status: 200 };
        }
        if (this._maybe) {
          return { data: rows.length > 0 ? project(rows[0]) : null, error: null, count: rows.length, status: 200 };
        }
        return { data: rows.map(project), error: null, count, status: 200 };
      }

      if (this._delete) {
        for (const r of rows) {
          const idx = table.indexOf(r);
          if (idx >= 0) table.splice(idx, 1);
        }
        return { data: rows, error: null, count: rows.length, status: 200 };
      }

      // Reads
      const project = (r: Row) => resolveSelect(r, this._select);
      if (wantCount) {
        return { data: rows.map(project), error: null, count: total, status: 200 };
      }
      if (this._single || this._maybe) {
        if (rows.length === 0) {
          return this._maybe
            ? { data: null, error: null, count: 0, status: 200 }
            : { data: null, error: { code: 'PGRST116', message: 'No rows found' }, count: 0, status: 406 };
        }
        return { data: project(rows[0]), error: null, count: 1, status: 200 };
      }
      return { data: rows.map(project), error: null, count: rows.length, status: 200 };
    }
  }

  return {
    uid,
    tables,
    from(name: string, opts?: any) {
      return new Builder(name, opts);
    },
    rpc(name: string, params?: any) {
      // Phase 5: emulate next_document_number() against the in-memory table
      if (name === 'next_document_number') {
        const workspaceId = params?.p_workspace;
        const docType = params?.p_type;
        const year = new Date().getFullYear();
        const table = getTable('document_sequences');
        let row = table.find((r) => r.workspace_id === workspaceId && r.doc_type === docType);
        if (row) {
          row.last_number = (row.last_number || 0) + 1;
        } else {
          row = { workspace_id: workspaceId, doc_type: docType, last_number: 1 };
          table.push(row);
        }
        const num = String(row.last_number).padStart(6, '0');
        return Promise.resolve({ data: `${docType}-${year}-${num}`, error: null, count: 1, status: 200 });
      }
      // Unknown rpc: resolve benignly
      return Promise.resolve({ data: null, error: null, count: 0, status: 200 });
    },
    /** Test-only accessors */
    __insert(table: string, rows: Row | Row[]) {
      getTable(table).push(...(Array.isArray(rows) ? rows : [rows]));
    },
    __all(table: string): Row[] {
      return getTable(table);
    },
    __reset() {
      for (const k of Object.keys(tables)) delete tables[k];
      idCounter = 0;
    },
  };
}

export type TestDb = ReturnType<typeof makeDb>;

// ============================================
// supabaseAdmin-shaped object
// ============================================
export function makeSupabaseAdminMock(db: TestDb, authUsers: Map<string, { id: string; email: string }>) {
  return {
    from: (t: string) => db.from(t),
    rpc: db.rpc,
    auth: {
      async getUser(token: string) {
        const user = authUsers.get(token);
        if (!user) {
          return { data: { user: null }, error: { message: 'Invalid token' } };
        }
        return { data: { user: { id: user.id, email: user.email } }, error: null };
      },
      async getSession() {
        return { data: { session: null }, error: null };
      },
    },
  };
}
