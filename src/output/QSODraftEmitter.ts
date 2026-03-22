import { v4 as uuidv4 } from 'uuid';
import type { QSODraft, QSOFields, QSOParticipant } from '../types/qso.js';
import type { ProcessedTurn } from '../types/turn.js';
import type { TraceEntry } from '../types/trace.js';

/**
 * Manages QSO draft lifecycle: creation, updates, and status transitions.
 */
export class QSODraftEmitter {
  private drafts: Map<string, QSODraft> = new Map();

  /**
   * Create a new draft.
   */
  create(
    fields: QSOFields,
    turns: ProcessedTurn[],
    trace: TraceEntry[],
    stations?: QSOParticipant[],
  ): QSODraft {
    const now = Date.now();
    const defaultRst = { value: '59', confidence: 0.3, source: 'rule' as const };
    const draft: QSODraft = {
      id: uuidv4(),
      status: 'draft',
      fields,
      stations: stations ?? [],
      rstAtoB: { ...defaultRst },
      rstBtoA: { ...defaultRst },
      turns: [...turns],
      trace: [...trace],
      createdAt: now,
      updatedAt: now,
    };
    this.drafts.set(draft.id, draft);
    return draft;
  }

  /**
   * Update an existing draft's fields and turns.
   */
  update(
    draftId: string,
    fields: QSOFields,
    turns: ProcessedTurn[],
    trace: TraceEntry[],
  ): QSODraft | null {
    const draft = this.drafts.get(draftId);
    if (!draft) return null;

    draft.fields = fields;
    draft.turns = [...turns];
    draft.trace = [...trace];
    draft.updatedAt = Date.now();

    // Auto-promote to ready if key fields resolved
    if (draft.status === 'draft' && this.isReady(draft)) {
      draft.status = 'ready';
    }

    return draft;
  }

  /**
   * Mark a draft as final (user confirmed).
   */
  confirm(draftId: string): QSODraft | null {
    const draft = this.drafts.get(draftId);
    if (!draft) return null;
    draft.status = 'final';
    draft.updatedAt = Date.now();
    return draft;
  }

  /**
   * Update station participants and direction-specific RSTs on a draft.
   */
  updateStations(
    draftId: string,
    stations: QSOParticipant[],
    rstAtoB?: { value: string; confidence: number; source: 'rule' | 'llm' | 'metadata' },
    rstBtoA?: { value: string; confidence: number; source: 'rule' | 'llm' | 'metadata' },
  ): void {
    const draft = this.drafts.get(draftId);
    if (!draft) return;
    draft.stations = stations;
    if (rstAtoB) draft.rstAtoB = rstAtoB;
    if (rstBtoA) draft.rstBtoA = rstBtoA;
    draft.updatedAt = Date.now();
  }

  /**
   * Discard a draft.
   */
  discard(draftId: string): boolean {
    return this.drafts.delete(draftId);
  }

  /**
   * Get a draft by ID.
   */
  get(draftId: string): QSODraft | null {
    return this.drafts.get(draftId) ?? null;
  }

  /**
   * Get all active (non-final) drafts.
   */
  getActive(): QSODraft[] {
    return Array.from(this.drafts.values()).filter(d => d.status !== 'final');
  }

  /**
   * Get all drafts.
   */
  getAll(): QSODraft[] {
    return Array.from(this.drafts.values());
  }

  /**
   * Check if a draft meets "ready" criteria.
   * Requires at least one station participant with confidence >= 0.6,
   * plus valid frequency and mode.
   */
  private isReady(draft: QSODraft): boolean {
    const hasConfidentStation = draft.stations.some(
      s => s.callsign !== '' && s.confidence >= 0.6,
    );
    return (
      hasConfidentStation &&
      draft.fields.frequency.value > 0 &&
      draft.fields.mode.value !== ''
    );
  }
}
