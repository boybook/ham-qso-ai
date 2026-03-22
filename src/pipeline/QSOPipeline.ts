import EventEmitter from 'eventemitter3';
import type { AudioChunk, RadioMetadata } from '../types/audio.js';
import type { QSOPipelineConfig } from '../types/config.js';
import type { QSODraft } from '../types/qso.js';
import type { ProcessedTurn, Turn } from '../types/turn.js';
import { createLogger, type ILogger } from '../utils/logger.js';
import { EnergyVAD } from '../segmentation/EnergyVAD.js';
import { AudioIngestionManager } from '../ingestion/AudioIngestionManager.js';
import { ASRManager } from '../asr/ASRManager.js';
import { RuleBasedFeatureExtractor, type IFeatureExtractor } from '../extraction/FeatureExtractor.js';
import { QSOSessionEngine } from '../session/QSOSessionEngine.js';
import { VotingFieldResolver, type IFieldResolver } from '../resolver/FieldCandidateResolver.js';
import { QSODraftEmitter } from '../output/QSODraftEmitter.js';

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
 * Main QSO pipeline. Orchestrates all pluggable layers:
 *
 * Audio → [Segmenter] → [ASR] → [Feature Extractor] → [Session Engine] → [Field Resolver] → Draft
 *
 * Each layer is pluggable via config. Defaults:
 * - Segmenter: EnergyVAD (local)
 * - ASR: user-provided (required)
 * - Feature Extractor: RuleBasedFeatureExtractor (local)
 * - Session Engine: QSOSessionEngine (deterministic state machine, not pluggable)
 * - Field Resolver: VotingFieldResolver (candidate pool voting)
 */
export class QSOPipeline extends EventEmitter<QSOPipelineEvents> {
  private readonly config: QSOPipelineConfig;
  private readonly logger: ILogger;
  private readonly ingestion: AudioIngestionManager;
  private readonly asrManager: ASRManager;
  private readonly extractor: IFeatureExtractor;
  private readonly sessionEngine: QSOSessionEngine;
  private readonly resolver: IFieldResolver;
  private readonly draftEmitter: QSODraftEmitter;
  private currentDraftId: string | null = null;
  private lastFrequency: number = 0;
  private started: boolean = false;

  constructor(config: QSOPipelineConfig) {
    super();
    this.config = config;
    this.logger = createLogger('QSOPipeline', config.logger);

    // Segmenter: use provided or default EnergyVAD
    const vad = config.segmenter ?? new EnergyVAD({
      energyThreshold: config.vad?.energyThreshold,
      minSpeechDuration: config.vad?.minSpeechDuration,
      silenceTimeout: config.vad?.silenceTimeout,
    });

    // ASR: always user-provided
    this.asrManager = new ASRManager({
      primary: config.asr.primary,
      fallback: config.asr.fallback,
      logger: config.logger,
    });

    // Feature Extractor: use provided or default rule-based
    this.extractor = config.extractor ?? new RuleBasedFeatureExtractor();

    // Session Engine: deterministic, not pluggable
    this.sessionEngine = new QSOSessionEngine({
      myCallsign: config.session.myCallsign,
      silenceTimeout: config.sessionTimeout ? Math.min(config.sessionTimeout / 20, 15000) : 15000,
    });

    // Field Resolver: use provided or default voting-based
    this.resolver = config.resolver ?? new VotingFieldResolver(config.session.myCallsign);

    // Output
    this.draftEmitter = new QSODraftEmitter();
    this.ingestion = new AudioIngestionManager(vad);

    // Wire layers
    this.ingestion.onTurn(turn => this.handleTurn(turn));
    this.sessionEngine.on('sessionStarted', qsoId => this.handleSessionStarted(qsoId));
    this.sessionEngine.on('sessionClosed', qsoId => this.handleSessionClosed(qsoId));
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.asrManager.initialize();
    this.sessionEngine.start();
    this.started = true;
    this.logger.info('pipeline started');
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.ingestion.flush();
    this.sessionEngine.stop();
    this.started = false;
    this.logger.info('pipeline stopped');
  }

  async dispose(): Promise<void> {
    await this.stop();
    await this.asrManager.dispose();
    this.logger.info('pipeline disposed');
  }

  pushAudio(chunk: AudioChunk): void {
    if (!this.started) return;
    this.ingestion.pushAudio(chunk);
  }

  pushMetadata(metadata: RadioMetadata): void {
    this.ingestion.pushMetadata(metadata);
    this.resolver.updateMetadata(metadata.frequency, metadata.mode);

    if (this.lastFrequency > 0 && metadata.frequency !== this.lastFrequency) {
      const diff = Math.abs(metadata.frequency - this.lastFrequency);
      if (diff > 1000) {
        this.sessionEngine.onFrequencyChanged(metadata.frequency);
      }
    }
    this.lastFrequency = metadata.frequency;
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

  private async handleTurn(turn: Turn): Promise<void> {
    try {
      const ctx = this.sessionEngine.getContext();
      const knownCallsigns = ctx.detectedCallsigns.map(c => c.callsign);
      const prompt = [this.config.session.myCallsign, ...knownCallsigns].join(' ');

      const asrResult = await this.asrManager.transcribe(
        turn.audio, turn.sampleRate,
        { language: this.config.session.languageHint, prompt },
      );

      if (!asrResult || !asrResult.text.trim()) return;

      // Feature extraction (may be async if LLM-based)
      const features = await this.extractor.extract(asrResult.text, turn.id, {
        knownCallsigns,
        myCallsign: this.config.session.myCallsign,
        frequency: this.lastFrequency,
        language: this.config.session.languageHint,
      });

      const processedTurn: ProcessedTurn = {
        ...turn,
        text: asrResult.text,
        asrConfidence: asrResult.confidence,
        asrProvider: asrResult.provider,
        features,
        speaker: turn.direction === 'tx' ? this.config.session.myCallsign : undefined,
      };

      this.sessionEngine.processTurn(processedTurn);
      this.resolver.processTurn(processedTurn);
      this.emit('turn:transcribed', processedTurn);
      this.updateCurrentDraft();
    } catch (err) {
      this.logger.error('turn processing failed', err);
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  private handleSessionStarted(_qsoId: string): void {
    const fields = this.resolver.resolve();
    const turns = this.sessionEngine.getTurns();
    const trace = this.sessionEngine.getTrace();
    const draft = this.draftEmitter.create(fields, turns, trace);
    this.currentDraftId = draft.id;
    this.emit('qso:draft', draft);
    this.logger.info('new QSO draft created', { draftId: draft.id });
  }

  private handleSessionClosed(_qsoId: string): void {
    if (!this.currentDraftId) return;
    const draft = this.updateCurrentDraft();
    if (draft) {
      this.emit('qso:closed', draft);
      this.logger.info('QSO session closed', {
        draftId: draft.id, status: draft.status,
        callsign: draft.fields.theirCallsign.value,
      });
    }
    this.currentDraftId = null;
    this.resolver.clear();
    this.sessionEngine.reset();
  }

  private updateCurrentDraft(): QSODraft | null {
    if (!this.currentDraftId) return null;
    const fields = this.resolver.resolve();
    const turns = this.sessionEngine.getTurns();
    const trace = this.sessionEngine.getTrace();
    const previousDraft = this.draftEmitter.get(this.currentDraftId);
    const previousStatus = previousDraft?.status;

    const draft = this.draftEmitter.update(this.currentDraftId, fields, turns, trace);
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
