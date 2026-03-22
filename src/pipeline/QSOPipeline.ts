import EventEmitter from 'eventemitter3';
import type { AudioChunk, RadioMetadata } from '../types/audio.js';
import type { QSOPipelineConfig } from '../types/config.js';
import type { QSODraft, QSOParticipant } from '../types/qso.js';
import type { ProcessedTurn, Turn } from '../types/turn.js';
import type { ITurnProcessor } from '../types/providers.js';
import { createLogger, type ILogger } from '../utils/logger.js';
import { EnergyVAD } from '../segmentation/EnergyVAD.js';
import { AudioIngestionManager } from '../ingestion/AudioIngestionManager.js';
import { ChainedTurnProcessor } from '../processor/ChainedTurnProcessor.js';
import { ChainedConversationProcessor } from '../processor/ChainedConversationProcessor.js';
import { ASRManager } from '../asr/ASRManager.js';
import { QSOSessionEngine } from '../session/QSOSessionEngine.js';
import { getFrequencyChangeThreshold } from '../session/QSOStateMachine.js';
import { QSODraftEmitter } from '../output/QSODraftEmitter.js';
import { StationRegistry } from '../station/StationRegistry.js';

/**
 * Events emitted by the QSO pipeline.
 */
export interface QSOPipelineEvents {
  'qso:draft': (draft: QSODraft) => void;
  'qso:updated': (draft: QSODraft) => void;
  'qso:ready': (draft: QSODraft) => void;
  'qso:closed': (draft: QSODraft) => void;
  'turn:transcribed': (turn: ProcessedTurn) => void;
  'error': (error: Error) => void;
}

/**
 * Main QSO pipeline.
 *
 * Audio → [Segmenter] → [Turn Processor] → [Session Engine] → Draft
 *
 * The turn processor is a unified abstraction that handles both ASR
 * and feature extraction. Three modes:
 * - OmniConversationProcessor: multimodal LLM conversation (recommended)
 * - ChainedTurnProcessor: ASR + extractor chain (legacy compatible)
 * - Any custom ITurnProcessor implementation
 */
export class QSOPipeline extends EventEmitter<QSOPipelineEvents> {
  private readonly config: QSOPipelineConfig;
  private readonly logger: ILogger;
  private readonly ingestion: AudioIngestionManager;
  private readonly processor: ITurnProcessor;
  private readonly sessionEngine: QSOSessionEngine;
  private readonly draftEmitter: QSODraftEmitter;
  readonly stationRegistry: StationRegistry;
  private readonly candidateDraftMap: Map<string, string> = new Map();
  private lastFrequency: number = 0;
  private lastMode: string = '';
  private started: boolean = false;

  // Async turn queue: ensures sequential processing + clean drain on stop
  private readonly turnQueue: Turn[] = [];
  private processing: boolean = false;
  private drainResolvers: Array<() => void> = [];

  constructor(config: QSOPipelineConfig) {
    super();
    this.config = config;
    this.logger = createLogger('QSOPipeline', config.logger);

    const vad = config.segmenter ?? new EnergyVAD({
      energyThreshold: config.vad?.energyThreshold,
      minSpeechDuration: config.vad?.minSpeechDuration,
      silenceTimeout: config.vad?.silenceTimeout,
    });

    // Resolve turn processor: unified or legacy
    if (config.processor) {
      this.processor = config.processor;
    } else if (config.asr) {
      // Backward compatible: wrap ASR + extractor into ChainedTurnProcessor
      // Use ASRManager to support primary + fallback
      this.processor = new ChainedTurnProcessor({
        asr: new ASRManager({
          primary: config.asr.primary,
          fallback: config.asr.fallback,
          logger: config.logger,
        }),
        extractor: config.extractor,
        language: config.session.languageHint,
        myCallsign: config.session.myCallsign,
        logger: config.logger,
      });
    } else {
      throw new Error('QSOPipelineConfig must provide either "processor" or "asr"');
    }

    this.sessionEngine = new QSOSessionEngine({
      myCallsign: config.session.myCallsign,
      silenceTimeout: config.silenceTimeout ?? 15000,
      holdTimeout: config.holdTimeout ?? 120000,
    });

    this.draftEmitter = new QSODraftEmitter();
    this.stationRegistry = new StationRegistry(config.logger);
    this.ingestion = new AudioIngestionManager(vad);

    // Wire layers — enqueue turns for sequential async processing
    this.ingestion.onTurn(turn => this.enqueueTurn(turn));
    this.sessionEngine.on('sessionStarted', id => this.handleSessionStarted(id));
    this.sessionEngine.on('sessionClosed', id => this.handleSessionClosed(id));
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.processor.initialize();

    // Wire late-arriving LLM features (for ChainedConversationProcessor)
    if (this.processor instanceof ChainedConversationProcessor) {
      this.processor.onLateFeatures = (_text, features) => {
        // Feed into station registry + session engine
        this.stationRegistry.feedLateFeatures(features);
        if (features.callsignCandidates.length > 0) {
          this.processor.updateContext({
            knownCallsigns: features.callsignCandidates.map(c => c.value),
          });
          this.sessionEngine.processLateFeatures(features);
        }
        this.updatePrimaryDraft();
        this.syncStationsToActiveDrafts();
      };
    }

    this.sessionEngine.start();
    this.started = true;
    this.logger.info('pipeline started');
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.ingestion.flush();
    // Wait for the queue to drain (all enqueued turns fully processed)
    await this.drain();
    this.sessionEngine.stop();
    this.started = false;
    this.logger.info('pipeline stopped');
  }

  async dispose(): Promise<void> {
    await this.stop();
    await this.processor.dispose();
    this.logger.info('pipeline disposed');
  }

  pushAudio(chunk: AudioChunk): void {
    if (!this.started) return;
    this.ingestion.pushAudio(chunk);
  }

  pushMetadata(metadata: RadioMetadata): void {
    this.ingestion.pushMetadata(metadata);
    this.sessionEngine.updateMetadata(metadata.frequency, metadata.mode);

    // Push metadata to processor for context
    this.processor.updateContext({
      frequency: metadata.frequency,
      mode: metadata.mode,
    });

    // Mode-aware frequency change detection
    if (this.lastFrequency > 0 && metadata.frequency !== this.lastFrequency) {
      const threshold = getFrequencyChangeThreshold(this.lastMode || metadata.mode);
      const diff = Math.abs(metadata.frequency - this.lastFrequency);
      if (diff > threshold) {
        this.sessionEngine.onFrequencyChanged(metadata.frequency);
        this.processor.reset(); // New frequency = new conversation
      }
    }
    this.lastFrequency = metadata.frequency;
    this.lastMode = metadata.mode;
  }

  getActiveDrafts(): QSODraft[] {
    return this.draftEmitter.getActive();
  }

  confirmDraft(draftId: string): QSODraft | null {
    const draft = this.draftEmitter.confirm(draftId);
    if (draft) this.emit('qso:closed', draft);
    return draft;
  }

  discardDraft(draftId: string): void {
    this.draftEmitter.discard(draftId);
  }

  // ─── Turn queue ──────────────────────────────────────────────

  /**
   * Enqueue a turn for sequential async processing.
   * VAD calls this synchronously; the queue ensures turns are processed
   * one at a time (important for conversation context ordering).
   */
  private enqueueTurn(turn: Turn): void {
    this.turnQueue.push(turn);
    this.processQueue();
  }

  /**
   * Process turns from the queue one at a time.
   * If already processing, this is a no-op (the current loop will pick up new items).
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.turnQueue.length > 0) {
        const turn = this.turnQueue.shift()!;
        await this.handleTurn(turn);
      }
    } finally {
      this.processing = false;
      // Notify anyone waiting for drain
      for (const resolve of this.drainResolvers) resolve();
      this.drainResolvers = [];
    }
  }

  /**
   * Returns a Promise that resolves when the queue is empty and
   * no turn is being processed. Resolves immediately if already idle.
   */
  private drain(): Promise<void> {
    if (!this.processing && this.turnQueue.length === 0) {
      return Promise.resolve();
    }
    this.logger.info('draining turn queue', {
      queued: this.turnQueue.length,
      processing: this.processing,
    });
    return new Promise<void>(resolve => {
      this.drainResolvers.push(resolve);
    });
  }

  // ─── Turn processing ─────────────────────────────────────────

  private async handleTurn(turn: Turn): Promise<void> {
    try {
      const result = await this.processor.processTurn(turn.audio, turn.sampleRate);
      if (!result.text.trim()) return;

      // Push discovered callsigns back to processor for context
      if (result.features.callsignCandidates.length > 0) {
        this.processor.updateContext({
          knownCallsigns: result.features.callsignCandidates.map(c => c.value),
        });
      }

      const processedTurn: ProcessedTurn = {
        ...turn,
        text: result.text,
        asrConfidence: result.confidence,
        asrProvider: result.provider,
        features: result.features,
        speaker: turn.direction === 'tx' ? this.config.session.myCallsign : undefined,
        speakerConfidence: turn.direction === 'tx' ? 1.0 : undefined,
      };

      // Feed turn info into station registry
      this.stationRegistry.feedTurn(processedTurn);

      this.sessionEngine.processTurn(processedTurn);
      this.emit('turn:transcribed', processedTurn);
      this.updatePrimaryDraft();
      this.syncStationsToActiveDrafts();
    } catch (err) {
      this.logger.error('turn processing failed', err);
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  // ─── Station → Draft sync ───────────────────────────────────

  /**
   * Sync station context info to all active drafts.
   * Reads from StationRegistry and populates QSODraft.stations[].
   */
  private syncStationsToActiveDrafts(): void {
    for (const draft of this.draftEmitter.getActive()) {
      // Build participant list from all stations known to this draft's candidate
      const candidateId = [...this.candidateDraftMap.entries()]
        .find(([, dId]) => dId === draft.id)?.[0];
      if (!candidateId) continue;

      const candidate = this.sessionEngine.getCandidate(candidateId);
      if (!candidate) continue;

      const participants: QSOParticipant[] = [];
      for (const cs of candidate.callsigns) {
        const station = this.stationRegistry.get(cs);
        if (station) {
          participants.push({
            callsign: station.callsign,
            confidence: station.confidence,
            qth: station.resolveQTH()?.value,
            name: station.resolveName()?.value,
            grid: station.resolveGrid()?.value,
            equipment: station.resolveEquipment()?.value,
          });
        }
      }

      if (participants.length > 0) {
        this.draftEmitter.updateStations(draft.id, participants);
      }
    }
  }

  // ─── Draft management ─────────────────────────────────────────

  private handleSessionStarted(candidateId: string): void {
    const candidate = this.sessionEngine.getPrimaryCandidate();
    if (!candidate) return;

    const fields = candidate.resolveFields();
    const turns = candidate.getTurns();
    const trace = candidate.getTrace();
    const draft = this.draftEmitter.create(fields, turns, trace);
    this.candidateDraftMap.set(candidateId, draft.id);
    this.emit('qso:draft', draft);
    this.logger.info('new QSO draft created', { draftId: draft.id, candidateId });
  }

  private handleSessionClosed(candidateId: string): void {
    const draftId = this.candidateDraftMap.get(candidateId);
    if (!draftId) return;

    const draft = this.updateDraftForCandidate(candidateId);
    if (draft) {
      this.emit('qso:closed', draft);
      this.logger.info('QSO session closed', {
        draftId: draft.id, status: draft.status,
        callsign: draft.fields.theirCallsign.value,
      });
    }

    this.candidateDraftMap.delete(candidateId);

    const activeCandidates = this.sessionEngine.getCandidates()
      .filter(c => c.status === 'candidate' || c.status === 'active');
    if (activeCandidates.length === 0) {
      this.sessionEngine.reset();
      // Do NOT reset processor here — conversation context should persist
      // across QSO boundaries on the same frequency. Processor is only
      // reset on frequency change (in pushMetadata) or dispose().
    }
  }

  private updatePrimaryDraft(): void {
    const primary = this.sessionEngine.getPrimaryCandidate();
    if (!primary) return;
    this.updateDraftForCandidate(primary.id);
  }

  private updateDraftForCandidate(candidateId: string): QSODraft | null {
    const draftId = this.candidateDraftMap.get(candidateId);
    if (!draftId) return null;

    const candidate = this.sessionEngine.getCandidate(candidateId);
    if (!candidate) return null;

    const fields = candidate.resolveFields();
    const turns = candidate.getTurns();
    const trace = candidate.getTrace();
    const previousDraft = this.draftEmitter.get(draftId);
    const previousStatus = previousDraft?.status;

    const draft = this.draftEmitter.update(draftId, fields, turns, trace);
    if (draft) {
      this.emit('qso:updated', draft);
      if (previousStatus === 'draft' && draft.status === 'ready') {
        this.emit('qso:ready', draft);
        this.logger.info('QSO draft ready', {
          draftId: draft.id, callsign: draft.fields.theirCallsign.value,
        });
      }
    }
    return draft;
  }
}
