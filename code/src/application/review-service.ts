import type { Candidate, DossierItem, DossierVersion } from '../domain/types.ts';
import type { EventStore } from '../infrastructure/event-store.ts';

export class ReviewService {
  private readonly store: EventStore;

  constructor(store: EventStore) {
    this.store = store;
  }

  inbox(workspaceId: string): Candidate[] {
    return this.store.listCandidates(workspaceId, 'pending');
  }

  accept(candidateId: string, editedStatement?: string): { item: DossierItem; version: DossierVersion } {
    return this.store.acceptCandidate(candidateId, editedStatement);
  }

  ignore(candidateId: string): void {
    this.store.setCandidateStatus(candidateId, 'ignored');
  }

  rollback(itemId: string, versionNo: number): DossierItem {
    return this.store.rollbackDossierItem(itemId, versionNo);
  }

  dossier(workspaceId: string): DossierItem[] {
    return this.store.listDossier(workspaceId);
  }

  versions(itemId: string): DossierVersion[] {
    return this.store.listDossierVersions(itemId);
  }
}
