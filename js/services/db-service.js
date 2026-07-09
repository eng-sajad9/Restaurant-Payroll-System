/**
 * db-service.js
 * Offline-first Database Service Layer utilizing Dexie.js for IndexedDB storage.
 * Designed with a Provider Pattern to support future Firebase migration.
 * Includes a Mock Supabase Client Adapter to mimic Postgrest query chains.
 */

// ─── UUID Generator ──────────────────────────────────────────────────────────
function generateUUID() {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
        return window.crypto.randomUUID();
    }
    // Fallback generator
    return 'id-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now().toString(36);
}

// ─── SHA-256 Hashing Helper (Standalone for early initialization) ────────────
async function hashSha256(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Database Provider Base Class ─────────────────────────────────────────────
class DatabaseProvider {
    async select(table, options) { throw new Error("Method select() not implemented"); }
    async insert(table, records) { throw new Error("Method insert() not implemented"); }
    async update(table, id, data) { throw new Error("Method update() not implemented"); }
    async delete(table, id) { throw new Error("Method delete() not implemented"); }
    async deleteBulk(table, ids) { throw new Error("Method deleteBulk() not implemented"); }
}

// ─── IndexedDB Provider (Dexie.js Implementation) ────────────────────────────
class IndexedDBProvider extends DatabaseProvider {
    constructor() {
        super();
        this.db = new Dexie('RestaurantPayrollDB');
        
        // Define database version & tables
        this.db.version(2).stores({
            users: 'id, username, role',
            employees: 'id, name, role, created_at',
            drivers: 'id, name, default_shift, created_at',
            salaries: 'id, employee_id, month, pay_period, created_at',
            audit_logs: 'id, user_id, action, target_type, created_at'
        });
        // v3: add deduction_logs table for per-entry audit trail
        this.db.version(3).stores({
            users: 'id, username, role',
            employees: 'id, name, role, created_at',
            drivers: 'id, name, default_shift, created_at',
            salaries: 'id, employee_id, month, pay_period, created_at',
            audit_logs: 'id, user_id, action, target_type, created_at',
            deduction_logs: 'id, employee_id, month, added_by, added_at'
        });
    }

    async select(table, options = {}) {
        const { filters = [], sortField = null, sortAscending = true, limit = null } = options;
        const dbTable = this.db.table(table);
        
        // Find schema definition to identify indexed fields in this store
        const schema = this.db.tables.find(t => t.name === table)?.schema || {};
        const indexedFields = new Set([schema.primKey?.name, ...schema.indexes?.map(i => i.name)].filter(Boolean));

        let records = [];

        // Try to optimize using the first equality filter that runs on an indexed column
        const firstIndexedFilter = filters.find(f => f.type === 'eq' && indexedFields.has(f.field));

        if (firstIndexedFilter) {
            // Retrieve only the matching subset using IndexedDB B-Tree index lookup
            records = await dbTable.where(firstIndexedFilter.field).equals(firstIndexedFilter.value).toArray();
        } else {
            // Fallback: Retrieve all records if no index is queried
            records = await dbTable.toArray();
        }

        // Apply remaining filters in-memory
        for (const filter of filters) {
            if (firstIndexedFilter && filter === firstIndexedFilter) continue; // Already filtered by Index

            if (filter.type === 'eq') {
                records = records.filter(item => {
                    const itemVal = item[filter.field];
                    return String(itemVal ?? '').trim().toLowerCase() === String(filter.value ?? '').trim().toLowerCase();
                });
            } else if (filter.type === 'in') {
                const searchVals = new Set(filter.values.map(v => String(v ?? '').trim().toLowerCase()));
                records = records.filter(item => {
                    const itemVal = item[filter.field];
                    return searchVals.has(String(itemVal ?? '').trim().toLowerCase());
                });
            }
        }

        // Apply sorting
        if (sortField) {
            records.sort((a, b) => {
                const valA = a[sortField];
                const valB = b[sortField];
                
                if (valA === undefined || valA === null) return sortAscending ? 1 : -1;
                if (valB === undefined || valB === null) return sortAscending ? -1 : 1;

                if (typeof valA === 'string') {
                    return sortAscending ? valA.localeCompare(valB) : valB.localeCompare(valA);
                }
                return sortAscending ? valA - valB : valB - valA;
            });
        }

        // Apply limit
        if (limit !== null) {
            records = records.slice(0, limit);
        }

        return records;
    }

    async insert(table, records) {
        const isArray = Array.isArray(records);
        const arrayToInsert = isArray ? records : [records];
        const dbTable = this.db.table(table);
        const processedRecords = [];

        for (const item of arrayToInsert) {
            const record = { ...item };
            if (!record.id) {
                record.id = generateUUID();
            }
            if (!record.created_at) {
                record.created_at = new Date().toISOString();
            }
            await dbTable.add(record);
            processedRecords.push(record);
        }

        return isArray ? processedRecords : processedRecords[0];
    }

    async update(table, id, data) {
        const dbTable = this.db.table(table);
        const count = await dbTable.update(id, data);
        if (count === 0) {
            throw new Error(`Record with ID ${id} not found in ${table}`);
        }
        return await dbTable.get(id);
    }

    async delete(table, id) {
        await this.db.table(table).delete(id);
    }

    async deleteBulk(table, ids) {
        await this.db.table(table).bulkDelete(ids);
    }
}

// ─── Firebase Provider (Future Skeleton Implementation) ──────────────────────
class FirebaseProvider extends DatabaseProvider {
    constructor() {
        super();
        console.warn("FirebaseProvider: Currently in skeleton state. Ready for future migration.");
    }
    
    async select(table, options) {
        console.log(`[FirebaseProvider] Selecting from ${table}...`);
        return [];
    }
    
    async insert(table, records) {
        console.log(`[FirebaseProvider] Inserting to ${table}...`);
        return records;
    }
    
    async update(table, id, data) {
        console.log(`[FirebaseProvider] Updating ID ${id} in ${table}...`);
        return data;
    }
    
    async delete(table, id) {
        console.log(`[FirebaseProvider] Deleting ID ${id} in ${table}...`);
    }

    async deleteBulk(table, ids) {
        console.log(`[FirebaseProvider] Deleting bulk IDs in ${table}...`);
    }
}

// ─── Database Service Coordinator & PubSub ───────────────────────────────────
class DatabaseService {
    constructor() {
        this.provider = new IndexedDBProvider();
        this.listeners = new Map(); // table -> Set of callbacks
    }

    /** Set or swap the database provider (e.g. FirebaseProvider) */
    setProvider(provider) {
        this.provider = provider;
        console.log("Database provider successfully swapped.");
    }

    /** Register real-time listeners for updates */
    subscribe(table, callback) {
        if (!this.listeners.has(table)) {
            this.listeners.set(table, new Set());
        }
        this.listeners.get(table).add(callback);
        
        // Return unsubscribe function
        return () => {
            const set = this.listeners.get(table);
            if (set) {
                set.delete(callback);
                if (set.size === 0) {
                    this.listeners.delete(table);
                }
            }
        };
    }

    /** Publish update events to simulated realtime subscriptions */
    publish(table, payload) {
        const set = this.listeners.get(table);
        if (set) {
            set.forEach(callback => {
                try {
                    callback(payload);
                } catch (e) {
                    console.error(`[PubSub] Error in listener callback for ${table}:`, e);
                }
            });
        }
    }

    async select(table, options) {
        return await this.provider.select(table, options);
    }

    async insert(table, records) {
        const result = await this.provider.insert(table, records);
        const arrayResult = Array.isArray(result) ? result : [result];
        arrayResult.forEach(record => {
            this.publish(table, { eventType: 'INSERT', new: record });
        });
        return result;
    }

    async update(table, id, data) {
        const result = await this.provider.update(table, id, data);
        this.publish(table, { eventType: 'UPDATE', new: result });
        return result;
    }

    async delete(table, id) {
        await this.provider.delete(table, id);
        this.publish(table, { eventType: 'DELETE', old: { id } });
    }

    async deleteBulk(table, ids) {
        await this.provider.deleteBulk(table, ids);
        ids.forEach(id => {
            this.publish(table, { eventType: 'DELETE', old: { id } });
        });
    }
}

// Instantiate and export database service globally
window.dbService = new DatabaseService();

// ─── Initial Admin User Seeding ──────────────────────────────────────────────
async function seedDefaultUsersIfEmpty() {
    try {
        const users = await window.dbService.select('users', { limit: 1 });
        if (users.length === 0) {
            console.log("[Seeding] Users table is empty. Generating default accounts...");
            const adminHash = await hashSha256('admin');
            const managerHash = await hashSha256('manager');
            const viewerHash = await hashSha256('viewer');
            const supervisorHash = await hashSha256('1234');

            await window.dbService.insert('users', [
                { username: 'admin', password_hash: adminHash, role: 'admin', can_view_analytics: true, can_delete: true },
                { username: 'manager', password_hash: managerHash, role: 'manager', can_view_analytics: true, can_delete: false },
                { username: 'viewer', password_hash: viewerHash, role: 'viewer', can_view_analytics: true, can_delete: false },
                { username: 'مراقب', password_hash: supervisorHash, role: 'مراقب', can_view_analytics: false, can_delete: false }
            ]);
            console.log("[Seeding] Seeding admin users completed.");
        } else {
            // Ensure مراقب user exists even in existing databases
            const allUsers = await window.dbService.select('users');
            const hasSupervisor = allUsers.some(u => u.role === 'مراقب');
            if (!hasSupervisor) {
                const supervisorHash = await hashSha256('1234');
                await window.dbService.insert('users', [
                    { username: 'مراقب', password_hash: supervisorHash, role: 'مراقب', can_view_analytics: false, can_delete: false }
                ]);
                console.log('[Seeding] مراقب user created.');
            }
        }
    } catch (e) {
        console.error("[Seeding] Seeding default users failed:", e);
    }
}

// Automatically seed when DOM/script is fully parsed
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', seedDefaultUsersIfEmpty);
} else {
    seedDefaultUsersIfEmpty();
}

// ─── Mock Supabase Client Query Builder (Postgrest Chainable Adapter) ────────
class MockSupabaseQueryBuilder {
    constructor(table, dbService) {
        this.table = table;
        this.dbService = dbService;
        this.filters = [];
        this.sortField = null;
        this.sortAscending = true;
        this.limitVal = null;
        this.selectFields = '*';
        this.selectOptions = {};
        this.isSingle = false;
        this.action = 'select'; // 'select' | 'insert' | 'update' | 'delete'
        this.actionData = null;
    }

    select(fields, options = {}) {
        this.selectFields = fields;
        this.selectOptions = options;
        return this;
    }

    eq(field, value) {
        this.filters.push({ type: 'eq', field, value });
        return this;
    }

    in(field, values) {
        this.filters.push({ type: 'in', field, values });
        return this;
    }

    order(field, options = {}) {
        this.sortField = field;
        this.sortAscending = options.ascending !== false;
        return this;
    }

    limit(value) {
        this.limitVal = value;
        return this;
    }

    single() {
        this.isSingle = true;
        return this;
    }

    insert(records) {
        this.action = 'insert';
        this.actionData = records;
        return this;
    }

    update(data) {
        this.action = 'update';
        this.actionData = data;
        return this;
    }

    delete() {
        this.action = 'delete';
        return this;
    }

    // Resolves thenable syntax automatically on await
    async then(resolve, reject) {
        try {
            let data = null;
            let count = undefined;

            if (this.action === 'select') {
                const records = await this.dbService.select(this.table, {
                    filters: this.filters,
                    sortField: this.sortField,
                    sortAscending: this.sortAscending,
                    limit: this.limitVal
                });
                data = records;
                if (this.isSingle) {
                    data = (records && records.length > 0) ? records[0] : null;
                }
                if (this.selectOptions && this.selectOptions.count === 'exact') {
                    count = records.length;
                }
            } else if (this.action === 'insert') {
                data = await this.dbService.insert(this.table, this.actionData);
            } else if (this.action === 'update') {
                const idFilter = this.filters.find(f => f.field === 'id' && f.type === 'eq');
                if (!idFilter) throw new Error('Update operation requires .eq("id", value)');
                data = await this.dbService.update(this.table, idFilter.value, this.actionData);
            } else if (this.action === 'delete') {
                const idFilter = this.filters.find(f => f.field === 'id' && f.type === 'eq');
                const inFilter = this.filters.find(f => f.type === 'in');
                if (idFilter) {
                    await this.dbService.delete(this.table, idFilter.value);
                } else if (inFilter) {
                    await this.dbService.deleteBulk(this.table, inFilter.values);
                } else {
                    throw new Error('Delete operation requires .eq("id", value) or .in("id", [...])');
                }
            }

            resolve({ data, count, error: null });
        } catch (err) {
            console.error(`[MockSupabase] Query failure on ${this.table}:`, err);
            resolve({ data: null, error: err });
        }
    }
}

// ─── Mock Supabase Realtime Channels ──────────────────────────────────────────
class MockSupabaseChannel {
    constructor(channelName, dbService) {
        this.channelName = channelName;
        this.dbService = dbService;
        this.callbacks = [];
        this.table = null;
        this.unsubFn = null;
    }

    on(event, filter, callback) {
        this.table = filter.table;
        this.callbacks.push(callback);
        return this;
    }

    subscribe() {
        this.unsubFn = this.dbService.subscribe(this.table, (payload) => {
            this.callbacks.forEach(cb => {
                try {
                    cb(payload);
                } catch (e) {
                    console.error(`[MockSupabaseChannel] Subscriber error:`, e);
                }
            });
        });
        MockSupabaseChannel.activeChannels.set(this, this.unsubFn);
        return this;
    }
}
MockSupabaseChannel.activeChannels = new Map();

// ─── Create Global Mock Supabase Object ───────────────────────────────────────
window.mockSupabase = {
    from(table) {
        return new MockSupabaseQueryBuilder(table, window.dbService);
    },
    channel(name) {
        return new MockSupabaseChannel(name, window.dbService);
    },
    removeChannel(channel) {
        const unsub = MockSupabaseChannel.activeChannels.get(channel);
        if (unsub) {
            unsub();
            MockSupabaseChannel.activeChannels.delete(channel);
        }
    }
};
