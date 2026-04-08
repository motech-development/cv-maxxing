import { primaryKey, text, sqliteTable } from 'drizzle-orm/sqlite-core'

export const metadataEntries = sqliteTable(
  'metadata_entries',
  {
    entryId: text('entry_id').notNull(),
    scope: text('scope').notNull(),
    updatedAt: text('updated_at').notNull(),
    valueJson: text('value_json').notNull(),
  },
  (table) => {
    return [primaryKey({ columns: [table.scope, table.entryId] })]
  },
)
