import { v4 as uuidv4 } from 'uuid';
import type { QSODraft, QSODraftStatus, QSOFields } from '../types/qso.js';
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
  create(fields: QSOFields, turns: ProcessedTurn[], trace: TraceEntry[]): QSODraft {
    const now = Date.now();
    const draft: QSODraft = {
      id: uuidv4(),
      status: 'draft',
      fields,
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
    if (draft.status === 'draft' && this.isReady(fields)) {
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
   * Check if fields meet "ready" criteria.
   */
  private isReady(fields: QSOFields): boolean {
    return (
      fields.theirCallsign.confidence >= 0.6 &&
      fields.theirCallsign.value !== '' &&
      fields.frequency.value > 0 &&
      fields.mode.value !== ''
    );
  }
}
