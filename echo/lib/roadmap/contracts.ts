// Explicit extension contracts, not implemented production capabilities.
export interface CandidateRetriever {
  find(organizationId: string, text: string): Promise<{ knowledgeId: string; score: number }[]>;
}
export interface KnowledgeGraph {
  impact(organizationId: string, knowledgeId: string): Promise<{ id: string; relation: string }[]>;
}
export interface EnterpriseProvisioner {
  syncVerifiedDirectory(organizationId: string): Promise<void>;
}
export interface MaintenanceScheduler {
  enqueueDueReviews(organizationId: string): Promise<void>;
}
export const roadmap = {
  2: 'Source connectors and queue workers: planned',
  3: 'Embeddings, impact graph and conflict clusters: planned',
  4: 'SCIM, retention and legal hold: planned',
  5: 'Continuous ingestion and proactive maintenance: planned',
};
