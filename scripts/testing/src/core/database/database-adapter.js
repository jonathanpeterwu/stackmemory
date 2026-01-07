/**
 * Database Adapter Interface
 * Provides abstraction layer for different database implementations
 * Supports SQLite (current) and ParadeDB (new) with seamless migration
 */
export class DatabaseAdapter {
    constructor(projectId, config) {
        this.projectId = projectId;
        this.config = config || {};
    }
    // Utility methods
    generateId() {
        return crypto.randomUUID();
    }
    sanitizeQuery(query) {
        // DEPRECATED: Use parameterized queries instead
        // This method is kept for legacy compatibility but should not be used
        console.warn('sanitizeQuery() is deprecated and unsafe - use parameterized queries');
        return query.replace(/[;'"\\]/g, '');
    }
    buildWhereClause(conditions) {
        const clauses = Object.entries(conditions).map(([key, value]) => {
            if (value === null) {
                return `${key} IS NULL`;
            }
            else if (Array.isArray(value)) {
                return `${key} IN (${value.map(() => '?').join(',')})`;
            }
            else {
                return `${key} = ?`;
            }
        });
        return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    }
    buildOrderByClause(orderBy, direction) {
        if (!orderBy)
            return '';
        return ` ORDER BY ${orderBy} ${direction || 'ASC'}`;
    }
    buildLimitClause(limit, offset) {
        if (!limit)
            return '';
        let clause = ` LIMIT ${limit}`;
        if (offset)
            clause += ` OFFSET ${offset}`;
        return clause;
    }
}
export class FeatureAwareDatabaseAdapter extends DatabaseAdapter {
    async canUseFeature(feature) {
        const features = this.getFeatures();
        return features[feature] || false;
    }
}
