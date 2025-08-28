import Dexie, { type Table } from 'dexie';

export type JobPosting = {
    id?: number,
    runId?: string,
    urn: string,
    jobId: string,
    title: string,
    listingDate: string,
    company: string,
    companyLink?: string,
    location: string,
    remote: boolean,
    salary: string,
    description?: string,
    applyUrl?: string,
    hasConnection: boolean,
}

export type ConnectionCompany = {
    id?: number,
    name: string,
}

export class DexieDB extends Dexie {
    jobPostings!: Table<JobPosting>;
    connectionCompanies!: Table<ConnectionCompany>;

    constructor() {
        super('EarlyBird');
        // these are the indexed columns, must update version number whenever making changes here
        this.version(8).stores({
            jobPostings: '++id, jobId, company, hasConnection',
            connectionCompanies: '++id, &name', // index name and ensure it's unique
        });
    }
}

export const db = new DexieDB();
