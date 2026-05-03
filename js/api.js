const API = {
    _graph: null,
    _entities: null,
    _archetypes: null,
    _factions: null,
    _assignments: null,
    _loaded: false,

    async _load() {
        if (this._loaded) return;
        const base = 'data/';
        const [graph, entities, archetypes, factions, assignments] = await Promise.all([
            fetch(base + 'graph.json').then(r => r.json()),
            fetch(base + 'entities.json').then(r => r.json()),
            fetch(base + 'archetypes.json').then(r => r.json()),
            fetch(base + 'factions.json').then(r => r.json()),
            fetch(base + 'layer_assignments.json').then(r => r.json()),
        ]);
        this._graph = graph;
        this._entities = entities;
        this._archetypes = archetypes;
        this._factions = factions;
        this._assignments = assignments;
        this._loaded = true;
    },

    async getGraphFull() {
        await this._load();
        return this._graph;
    },

    async getEntity(id) {
        await this._load();
        return this._entities[id] || this._entities[String(id)];
    },

    async searchEntities(q) {
        await this._load();
        const lower = q.toLowerCase();
        const results = [];
        for (const e of Object.values(this._entities)) {
            const haystack = (e.name + ' ' + e.archetype + ' ' + e.aspect + ' ' + e.tier).toLowerCase();
            if (haystack.includes(lower)) {
                results.push(e);
                if (results.length >= 20) break;
            }
        }
        return results;
    },

    async searchArchetypes(q) {
        await this._load();
        const lower = q.toLowerCase();
        const results = [];
        for (const a of Object.values(this._archetypes)) {
            if (a.name.toLowerCase().includes(lower)) {
                results.push(a);
                if (results.length >= 10) break;
            }
        }
        return results;
    },

    async getArchetype(slug) {
        await this._load();
        return this._archetypes[slug];
    },

    async getAllArchetypes() {
        await this._load();
        return this._archetypes;
    },

    async getFaction(id) {
        await this._load();
        return this._factions[id] || this._factions[String(id)];
    },

    async getAllFactions() {
        await this._load();
        return this._factions;
    },

    async getNeighborhood(id, depth = 1) {
        await this._load();
        const visited = new Set([id]);
        let frontier = [id];
        for (let d = 0; d < depth; d++) {
            const next = [];
            for (const nid of frontier) {
                for (const e of this._graph.edges) {
                    if (e.source === nid && !visited.has(e.target)) {
                        visited.add(e.target);
                        next.push(e.target);
                    }
                    if (e.target === nid && !visited.has(e.source)) {
                        visited.add(e.source);
                        next.push(e.source);
                    }
                }
            }
            frontier = next;
        }
        const nodes = this._graph.nodes.filter(n => visited.has(n.id));
        const edges = this._graph.edges.filter(e =>
            visited.has(e.source) && visited.has(e.target)
        );
        return { nodes, edges };
    },

    async getBranchAssignments() {
        await this._load();
        return this._assignments;
    },

    async getArchetypeForEntity(entityId) {
        await this._load();
        const id = parseInt(entityId);
        for (const arch of Object.values(this._archetypes)) {
            if (arch.carriers && arch.carriers.some(c => c.id === id)) {
                return arch;
            }
        }
        return null;
    },
};
