const { supabaseAdmin } = require('../config/supabase');
const { ApiError } = require('../lib/errors');

// Staff CRUD for the three portal-native taxonomy tables (023) --
// product_type, jewellery_type, colour. One generic service
// parameterized over a whitelisted "kind" rather than three near-
// identical files, since all three tables share the exact same shape
// (id, name, display_order). display_systems is deliberately NOT
// included here -- it stays Cin7 Category-sourced (see productSync.js)
// and has no staff-write path.
const KIND_TABLE = {
  types: 'product_types',
  'jewellery-types': 'product_jewellery_types',
  colours: 'product_colours',
};

function requireStaff(req) {
  if (!req.roles.isPortalAdmin) {
    throw new ApiError(403, 'This action is restricted to Shonrei staff');
  }
}

function tableFor(kind) {
  const table = KIND_TABLE[kind];
  if (!table) throw new ApiError(404, `Unknown taxonomy kind "${kind}"`);
  return table;
}

async function list(req, kind) {
  requireStaff(req);
  const table = tableFor(kind);
  const { data, error } = await supabaseAdmin.from(table).select('*').order('display_order').order('name');
  if (error) throw new ApiError(500, `Failed to list ${table}`, error.message);
  return data;
}

async function create(req, kind, input) {
  requireStaff(req);
  const table = tableFor(kind);
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  if (!name) throw new ApiError(400, 'name is required');
  const displayOrder = Number.isFinite(input?.display_order) ? input.display_order : 0;

  const { data, error } = await supabaseAdmin.from(table).insert({ name, display_order: displayOrder }).select().single();
  if (error) {
    if (error.code === '23505') throw new ApiError(409, `"${name}" already exists`);
    throw new ApiError(500, `Failed to create ${table} row`, error.message);
  }
  return data;
}

async function update(req, kind, id, input) {
  requireStaff(req);
  const table = tableFor(kind);
  const patch = {};
  if (typeof input?.name === 'string') {
    const name = input.name.trim();
    if (!name) throw new ApiError(400, 'name cannot be blank');
    patch.name = name;
  }
  if (input?.display_order !== undefined) {
    if (!Number.isFinite(input.display_order)) throw new ApiError(400, 'display_order must be a number');
    patch.display_order = input.display_order;
  }
  if (Object.keys(patch).length === 0) throw new ApiError(400, 'Nothing to update');

  const { data, error } = await supabaseAdmin.from(table).update(patch).eq('id', id).select().maybeSingle();
  if (error) {
    if (error.code === '23505') throw new ApiError(409, `"${patch.name}" already exists`);
    throw new ApiError(500, `Failed to update ${table} row`, error.message);
  }
  if (!data) throw new ApiError(404, 'Not found');
  return data;
}

async function remove(req, kind, id) {
  requireStaff(req);
  const table = tableFor(kind);
  const { error } = await supabaseAdmin.from(table).delete().eq('id', id);
  if (error) {
    // Postgres foreign_key_violation -- this type is still referenced
    // by a product or a client override. A clean 409 beats a raw DB
    // error surfacing in the admin screen.
    if (error.code === '23503') {
      throw new ApiError(409, 'Still in use by one or more products or client overrides -- reassign those first');
    }
    throw new ApiError(500, `Failed to delete ${table} row`, error.message);
  }
}

module.exports = { list, create, update, remove };
