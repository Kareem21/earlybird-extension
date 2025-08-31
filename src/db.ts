import Dexie, { type Table } from 'dexie';

export type Connection = {
    url: string,
}

export type PersonProfile = {
    url: string,
    data: any,
}

export type ConnectionCompany = {
    id?: number,
    name: string,
}

export class DexieDB extends Dexie {
    connections!: Table<Connection>;
    personProfileCache!: Table<PersonProfile>;
    connectionCompanies!: Table<ConnectionCompany>;

    constructor() {
        super('EarlyBird');
        // these are the indexed columns, must update version number whenever making changes here
        this.version(9).stores({
            connections: '&url', // index url and ensure it's unique
            personProfileCache: '&url', // index url and ensure it's unique
            connectionCompanies: '++id, &name', // index name and ensure it's unique
        });
    }
}

export const db = new DexieDB();
